Array.prototype.find = function (iterator, context) {
  for (var value, i = 0, len = this.length; i < len; i++) {
      value = this[i];
      if (iterator.call(context, value, i)) return value;
  }
  return undefined;
}

var recorder = require('./recorder.js');

// store connected clients in here
var clients = [];
//  ***
// | id | username | socket |
// |----|----------|--------|
//  ***

// store published streams in here
var streams = [];
//  ***
// | id | mainPublisherId | currentPublisherId | type | starttime | subscribers | record |
// |----|-----------------|--------------------|------|-----------|-------------|--------|
// 																	- id
// 																	- username
// 																	- timecode
//  ***

var streamId = 0;

var takeoverCallbacks = [];

// dont do that for now, needs some fixes
// setInterval(broadcastProgress, 1000);

// --- public functions --- //

function helloNetwork(ws, message) {
	registerSenderOf(ws, message);
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
}

function requestStreamId(clientId) {
	var id = requestNewStreamId();
	var message = {
		type: 'stream-id',
		id: id
	}

	sendMessageTo(clientId, message);
}

function subscribe(clientId, streamId) {
	var res = subscribeToStream(clientId, streamId);
	if (res === 'stream-unknown') {
		var message = {
			type: 'error',
			message: 'stream unknown - ' + streamId
		}

		sendMessageTo(clientId, message);
	}
}

function unsubscribe(clientId, streamId) {
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

function unpublish(clientId, streamId) {
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

function requestTakeover(ws, requesterId, streamId) {
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

	sendTakeoverRequest(requesterId, streamId, onResponse);
}

function responseTakeover(requesterId, streamId, response) {
	// atm, we do not care for the response and always allow taking over
	handleTakeover(streamId, requesterId);

	var callbackRecord = takeoverCallbacks.find(function(record) {
		return record.streamId === streamId && record.requesterId === requesterId;
	});

	var idx = takeoverCallbacks.indexOf(callbackRecord);
	if (idx >= 0) takeoverCallbacks.splice(idx, 1);

	callbackRecord.callback(response);
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

function updateProgress(clientId, streamId, time) {
	var stream = getStreamById(streamId);

	if (stream === 'stream-unknown') {
		return;
	}

	var subscriberRecord = stream.subscribers.find(function(subscriber) {
		return subscriber.id === clientId;
	});

	if (!subscriberRecord) {
		console.log('%s is not subscribed to %s', clientId, streamId);
		return;
	}

	subscriberRecord.timecode = time;
}

function requestAmountOfFrames(requestId, senderId, streamId, before, amount) {
	var stream = getStreamById(streamId);
	var message;
	if (!stream.record) {
		message = {
			type: 'error',
			message: 'stream not recorded'
		}
	} else {
		var data = recorder.getAmountOfFrames(streamId, before, amount);

		message = {
			type: 'recorded-data',
			streamId: streamId,
			requestId: requestId,
			data: data
		}
	}

	sendMessageTo(senderId, message);
}

function requestDurationOfFrames(requestId, senderId, streamId, before, amount) {
	var stream = getStreamById(streamId);
	var message;
	if (!stream.record) {
		message = {
			type: 'error',
			message: 'stream not recorded'
		}
	} else {
		var data = recorder.getDurationOfFrames(streamId, before, amount);

		message = {
			type: 'recorded-data',
			streamId: streamId,
			requestId: requestId,
			data: data
		}
	}

	sendMessageTo(senderId, message);
}

function handleStreamChunk(message) {
	registerStreamIfUnknown(message);

	forwardMessageToSubscribers(message);

	if (message.record) {
		recorder.recordFrame(message);
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
		unpublish(client.id, streamId);
	});

	// remove the client from the clients-list
	var idx = clients.indexOf(client);
	if (idx > -1) {
		clients.splice(idx, 1);
		console.log('Removed (%s) %s', client.username, client.id);
	}
}


// --- private functions --- //

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

function registerSenderOf(socket, message) {
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

function isKnownSender(senderId) {
	var client = getClientById(senderId);

	return !(client === 'client-unknown');
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

function broadcast(message) {
	message = JSON.stringify(message);
	clients.forEach(function(client) {
		if (client.socket.readyState === client.socket.OPEN) {
			client.socket.send(message);
		}
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
	if (client.socket.readyState === client.socket.OPEN) {
		client.socket.send(str);
	}
}

function forwardMessageToSubscribers(message) {
	var streamId = message.streamId;
	// get the stream to which the message belongs
	var stream = getStreamById(streamId);

	stream.subscribers.forEach(function(subscriber) {
		// get the client with the given id
		var client = getClientById(subscriber.id);

		// send the message to him
		if (client.socket.readyState === client.socket.OPEN) {
			client.socket.send(JSON.stringify(message));
		}
	});
}

function requestNewStreamId() {
	streamId++;
	return streamId;
}

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
		username: getClientById(clientId).username,
		timecode: -1
	});
	console.log('Subscribed:   %s to %s', clientId, streamId);
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

function sendTakeoverRequest(requesterId, streamId, callback) {
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

function registerStreamIfUnknown(message) {
	var stream = getStreamById(message.streamId);

	if (stream !== 'stream-unknown') {
		// stream already registered
		return;
	}

	// register new stream
	stream = {
		id: message.streamId,
		type: message.type,
		record: message.record,
		mainPublisherId: message.senderId,
		currentPublisherId: message.senderId,
		starttime: message.timestamp,
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


// --- exported functions --- //

module.exports = {
	helloNetwork: helloNetwork,
	requestStreamId: requestStreamId,
	subscribe: subscribe,
	unsubscribe: unsubscribe,
	unpublish: unpublish,
	requestTakeover: requestTakeover,
	responseTakeover: responseTakeover,
	releaseStream: releaseStream,
	updateProgress: updateProgress,
	requestAmountOfFrames: requestAmountOfFrames,
	requestDurationOfFrames: requestDurationOfFrames,
	handleStreamChunk: handleStreamChunk,
	removeClient: removeClient
}