Array.prototype.find = function (iterator, context) {
  for (var value, i = 0, len = this.length; i < len; i++) {
      value = this[i];
      if (iterator.call(context, value, i)) return value;
  }
  return undefined;
}

var fs = require('fs');

// start socket server
var port = 1234;
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: port});

console.log('Server runnung on port %d...', port);

// store connected clients in here
//  ***
// | id | username | socket |
// |----|----------|--------|
//  ***
var clients = [];

// store published streams in here
//  ***
// | id | mainPublisherId | currentPublisherId | type | subscribers |
// |----|-----------------|--------------------|------|-------------|
// 																											- id
// 																											- username
// 																											- timecode
//  ***
var streams = [];

// store callbacks in here, while waiting for publisher's approval to take-over a stream
var takeoverCallbacks = [];

var streamId = 0;
var imageCounter = 0;

setInterval(broadcastProgress, 1000);

wss.on('connection', function(ws) {	
	ws.on('close', function() {
		removeClient(ws);
	});
 
	ws.on('error', function(err) {
		console.log(err);
	});

	ws.on('message', function(message) {
		var parsedMessage = JSON.parse(message);

		// add a timestamp to each incoming message
		parsedMessage.timestamp = Date.now();

		switch (parsedMessage.type) {
			case 'hello-network':
				registerSenderOf(parsedMessage, ws);
				// send information about available streams
				var obj = {
					type: 'initial-information',
					streams: streams
				}
				var message = JSON.stringify(obj);
				ws.send(message);

				// inform all clients that 'clients' has changed
				// do not send the 'socket'-field
				var clientInfos = clients.map(function(client) {
					return {
						id: client.id,
						username: client.username
					}
				});

				broadcast({
					type: 'new-clients',
					clients: clientInfos
				});
				break;
			case 'request-stream-id':
				var id = requestNewStreamId();
				var obj = {
					type: 'stream-id',
					id: id
				}
				var message = JSON.stringify(obj);
				ws.send(message);
				break;
			case 'subscribe':
				var streamId = parsedMessage.streamId;
				var senderId = parsedMessage.senderId;
				
				var res = subscribeToStream(senderId, streamId);
				if (res === 'stream-unknown') {
					var obj = {
						type: 'error',
						message: 'stream unknown - ' + streamId
					}
					var message = JSON.stringify(obj);
					ws.send(message);
				}
				break;
			case 'request-takeover':
				var requesterId = parsedMessage.senderId;
				var streamId = parsedMessage.streamId;

				var socket = ws;
				function onResponse(response) {
					console.log('Received response to take-over stream %s by %s: %s', streamId, requesterId, response);
					var message = {
						type: 'response-takeover',
						streamId: streamId,
						response: response
					};

					socket.send(JSON.stringify(message));	
				}

				requestTakeover(requesterId, streamId, onResponse);
				break;
			case 'response-takeover':
				var streamId = parsedMessage.streamId;
				var requesterId = parsedMessage.requesterId;
				var response = parsedMessage.response;

				handleTakeover(streamId, requesterId);

				var callbackRecord = takeoverCallbacks.find(function(record) {
					return record.streamId === streamId && record.requesterId === requesterId;
				});

				var idx = takeoverCallbacks.indexOf(callbackRecord);
				if (idx >= 0) takeoverCallbacks.splice(idx, 1);

				callbackRecord.callback(response);
				break;
			case 'release-stream':
				var streamId = parsedMessage.streamId;

				releaseStream(streamId);
				break;
			case 'unsubscribe':
				var streamId = parsedMessage.streamId;
				var senderId = parsedMessage.senderId;

				// TODO: react on return value
				unsubscribeFromStream(senderId, streamId);
				break;
			case 'unpublish':
				var streamId = parsedMessage.streamId;
				var senderId = parsedMessage.senderId;

				unpublishStream(senderId, streamId);
				break;
			case 'progress-time':
				var senderId = parsedMessage.senderId;
				var streamId = parsedMessage.streamId;
				var time = parsedMessage.progressTime;
				updateProgress(senderId, streamId, time);
				break;
			default:
				// it's a stream chunk
				// check whether the messages belongs to a new stream
				var res = registerStreamIfUnknown(parsedMessage);
				if (res === 'unknown-sender') {
					// sender is not registered, do not forward message
					return;
				}

				// recording (quick and dirty)
				if (parsedMessage.type === 'image' && parsedMessage.record) {
					var imageURL = parsedMessage.image;
					if (parsedMessage.lzwEncoded) {
						imageURL = lzwDecode(imageURL);
					}
					var imageData = imageURL.split(',')[1];
					var buffer = new Buffer(imageData, 'base64');
					fs.writeFile('images/data' + getCounter() + '.webp', buffer);
					imageCounter++;
				}

				// forward the message to all subscribers
				forwardMessageToSubscribers(parsedMessage);
		}
	});
});


// --- sending functions ---

function broadcast(message) {
	message = JSON.stringify(message);
	clients.forEach(function(client) {
		if (client.socket.readyState === client.socket.OPEN) {
			client.socket.send(message);
		}
	});
}

function broadcastProgress() {
	streams.forEach(function(stream) {
		var message = {
			type: 'progress-update',
			streamId: stream.id,
			timestamps: stream.subscribers
		}

		forwardMessageToSubscribers(message);
	});
}

function forwardMessageToSubscribers(message) {
	var streamId = message.streamId;
	// get the stream to which the message belongs
	var stream = getStreamById(streamId);

	stream.subscribers.forEach(function(subscriber) {
		// get the client with the given id
		var client = getClientById(subscriber.id);

		// send the message to him
		client.socket.send(JSON.stringify(message));
	});
}

function sendMessageTo(clientId, message) {
	var client = getClientById(clientId);

	if (!client) {
		// receiver unknown
		console.log('Tried sending message to unknown receiver');
		return;
	}

	var str = JSON.stringify(message);
	client.socket.send(str);
}


// --- subscription-related functions ---

function subscribeToStream(clientId, streamId) {
	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		// stream does not exist
		console.log('%s tried to subscribe to unknown stream (%s)', clientId, streamId);
		return 'stream-unknown';
	}


	var client = stream.subscribers.find(function(subscriber) {
		return subscriber.id === clientId;
	});

	if (client) {
		// client already subscribed to this stream
		console.log('%s tried to subscribe to %s, but is already subscribed', clientId, streamId);
		return 'already-subscribed';
	}

	// add the client to the subscribers of the stream
	stream.subscribers.push({
		id: clientId,
		timecode: -1
	});
	console.log('Subscribed:   %s to %s', clientId, streamId);
}

function unsubscribeFromStream(clientId, streamId) {
	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		// stream does not exist
		console.log('%s tried to unsubscribe from unknown stream (%s)', clientId, streamId);
		return 'stream-unknown';
	}

	var client = stream.subscribers.find(function(subscriber) {
		return subscriber.id === clientId;
	})

	if (!client) {
		// client is not subscribed to the stream
		console.log('%s tried to unsubscribe from %s, but was not subscribed', clientId, streamId);
		return 'subscriber-unknown';
	}

	// remove the client from the subscriber list
	var idx = stream.subscribers.indexOf(client);
	stream.subscribers.splice(idx, 1);
	console.log('Unsubscribed: %s from %s', clientId, streamId);
}


// --- publishing-related functions ---

function registerStreamIfUnknown(message) {
	var stream = getStreamById(message.streamId);

	if (!(stream === 'stream-unknown')) {
		// stream already registered
		return;
	}

	// register new stream
	stream = {
		id: message.streamId,
		type: message.type,
		mainPublisherId: message.senderId,
		currentPublisherId: message.senderId,
		subscribers: []
	}

	streams.push(stream);

	// map names of publishers into stream data
	streamInfos = streams.map(function(stream) {
		var publisher = getClientById(stream.mainPublisherId);

		stream.publisherName = publisher.username;
		return stream;
	});

	// send new stream information to all clients
	broadcast({
		type: 'stream-changes',
		streams: streamInfos
	});

	console.log('Registered new stream (%s - %s) from %s', stream.type, stream.id, stream.mainPublisherId);
}

function unpublishStream(clientId, streamId) {
	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		// stream does not exist
		console.log('%s tried to unpublish %s, but stream does not exist', clientId, streamId);
		return 'stream-unknown';
	}

	var idx = streams.indexOf(stream);
	streams.splice(idx, 1);

	// send new stream information to all clients
	broadcast({
		type: 'stream-changes',
		streams: streams
	});

	console.log('%s unpublished stream %s', clientId, streamId);
}

function requestTakeover(requesterId, streamId, callback) {
	console.log('%s wants to take-over stream %s', requesterId, streamId);
	var requester = getClientById(requesterId);

	if (requester === 'client-unknown') {
		callback('sender-unknown');
		return;
	}

	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		callback('stream-unknown');
		return;
	}

	sendMessageTo(stream.currentPublisherId, {
		type: 'request-takeover',
		streamId: streamId,
		requesterId: requesterId,
		requesterName: requester.username
	});

	takeoverCallbacks.push({
		streamId: streamId,
		requesterId: requesterId,
		callback: callback
	});
}

function handleTakeover(streamId, newPublisherId) {
	var stream = getStreamById(streamId);

	stream.currentPublisherId = newPublisherId;
}

function releaseStream(streamId) {
	var stream = getStreamById(streamId);

	stream.currentPublisherId = stream.mainPublisherId;

	var message = {
		type: 'continue-streaming',
		streamId: streamId
	}

	sendMessageTo(stream.mainPublisherId, message);
}

function updateProgress(senderId, streamId, time) {
	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		return;
	}

	var subscriberRecord = stream.subscribers.find(function(subscriber) {
		return subscriber.id === senderId;
	});

	if (!subscriberRecord) {
		console.log('%s is not subscribed to %s', senderId, streamId);
		return;
	}

	subscriberRecord.timecode = time;
}


// --- client house-keeping ---

function registerSenderOf(message, socket) {
	// if the sender is yet unknown, create a new client record
	if (!isKnownSender(message.senderId)) {
		var client = {
			id: message.senderId,
			username: message.senderName,
			socket: socket
		}
		clients.push(client);
		console.log('Registered (%s) %s', client.username, client.id);
	}
}

function removeClient(socket) {
	var client = clients.find(function(client) {
		return client.socket === socket;
	});

	// collect all subscriptions of that client
	var streamIds = [];
	streams.forEach(function(stream) {
		stream.subscribers.forEach(function(subscriber) {
			if (subscriber.id === client.id) {
				streamIds.push(stream.id);
			}
		});
	});

	// unsubscribe from all that streams
	streamIds.forEach(function(streamId) {
		unsubscribeFromStream(client.id, streamId);
	})

	// collect all published streams of that client
	streamIds = [];
	streams.forEach(function(stream) {
		if (stream.mainPublisherId === client.id) {
			streamIds.push(stream.id);
		}
	});

	// unpublish all its streams
	streamIds.forEach(function(streamId) {
		unpublishStream(client.id, streamId);
	});

	// remove the client from the clients-list
	var idx = clients.indexOf(client);
	if (idx > -1) {
		clients.splice(idx, 1);
		console.log('Removed (%s) %s', client.username, client.id);
	}
}

function isKnownSender(senderId) {
	var client = getClientById(senderId);

	return !(client === 'client-unknown');
}


// --- utils ---

function requestNewStreamId() {
	streamId++;
	return streamId;
}

function getClientById(id) {
	var client = clients.find(function(client) {
		return client.id === id;
	});

	if (!client) {
		console.log('Client %s unknown', id);
		return 'client-unknown';
	}

	return client;
}

function getStreamById(id) {
	var stream = streams.find(function(stream) {
		return stream.id === id;
	});

	if (!stream) {
		console.log('Stream %s unknown', id);
		return 'stream-unknown';
	}

	return stream;
}

function lzwDecode(string) {
    var dict = {};
    var data = (string + "").split("");
    var currChar = data[0];
    var oldPhrase = currChar;
    var out = [currChar];
    var code = 256;
    var phrase;
    for (var i=1; i<data.length; i++) {
        var currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        }
        else {
           phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join("");
}

function getCounter() {
	var s = imageCounter + '';
	while (s.length < 5) {
		s = 0 + s;
	}
	return s;
}