var logic = require('./logic.js');

function handleMessage(socket, message) {
	var ws = socket;

 	switch (message.type) {
 		case 'hello-network':
 			logic.helloNetwork(ws, message);
			break;
		case 'request-stream-id':
			logic.requestStreamId(ws);
			break;
		case 'subscribe':
			var streamId = message.streamId;
			var senderId = message.senderId;

			logic.subscribe(ws, senderId, streamId);
			break;
		case 'request-takeover':
			var requesterId = parsedMessage.senderId;
			var streamId = parsedMessage.streamId;

			logic.requestTakeover(ws, requesterId, streamId);
			break;
		case 'response-takeover':
			var requesterId = message.requesterId;
			var streamId = message.streamId;
			var response = message.response;

			logic.responseTakeover(requesterId, streamId, response);
			break;
		case 'release-stream':
			var streamId = message.streamId;

			logic.releaseStream(streamId);
			break;
		case 'unsubscribe':
			var streamId = message.streamId;
			var senderId = message.senderId;

			logic.unsubscribe(senderId, streamId);
			break;
		case 'unpublish':
			var streamId = message.streamId;
			var senderId = message.senderId;

			logic.unpublish(senderId, streamId);
			break;
		case 'progress-time':
			var senderId = message.senderId;
			var streamId = message.streamId;
			var time = message.progressTime;

			logic.updateProgress(senderId, streamId, time);
			break;
		case 'request-recorded-data':
			var senderId = message.senderId;
			var streamId = message.streamId;
			var requestId = message.requestId;
			// amount of...
			var amount = message.amount;
			var before = message.before;
			// duration of...
			var timecode = message.timecode;
			var duration = message.duration;
			
			if (amount !== undefined) {
				logic.requestAmountOfFrames(requestId, streamId, before, amount);
			} else {
				logic.requestDurationOfFrames(requestId, streamId, timecode, duration);
			}
			break;
		default:
			logic.handleStreamChunk(message);
 	}
}


// --- Exported functions ---

module.exports = {
	handleMessage: handleMessage
}