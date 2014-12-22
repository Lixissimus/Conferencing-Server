var streamBuffers = {};
var bufferIndexes = {};

// the bigger the number, the less index entries are created
var indexPrecision = 10000;

function newStream(streamId) {
	console.log('Recorder: Creating new recording buffer for Stream %s', streamId);
	streamBuffers[streamId] = [];
	bufferIndexes[streamId] = {};

	return streamBuffers[streamId];
}

function recordFrame(frame) {
	var streamId = frame.streamId;
	var buffer = streamBuffers[streamId];
	
	if (!buffer) {
		buffer = newStream(streamId);
	}

	buffer.push(frame);

	var index = getIndexKey(frame.timestamp);
	// there is no index entry for that frame, so create one
	if (bufferIndexes[streamId][index] === undefined) {
		bufferIndexes[streamId][index] = buffer.length;
	}
}

function getFrames(streamId, timestamp, length) {
	// return an array of frames from timestamp for a timespan
	// of length seconds, or just one frame, if length not given

	var buffer = streamBuffers[streamId];

	// if no timestamp given, take the one from the first recoded frame
	if (timestamp === null || timestamp === undefined) {
		timestamp = buffer[0].timestamp;
	}

	// if length equals 'all', set it to the duration from timestamp 
	// to the end of the recording
	if (length === 'all') {
		// calculate the length of the whole recording in seconds
		length = (buffer[buffer.length - 1].timestamp - timestamp) / 1000;
	}

	var indexKey = getIndexKey(timestamp);
	var idx = bufferIndexes[streamId][indexKey];

	if (idx === undefined) {
		console.log('Recorder: Error while retrieving frame of Stream %s', streamId);
		return;
	}

	// From idx position in buffer, run through the buffer until we find
	// a frame, with a timestamp greater than the one we are looking for.
	// The frame before that is the best match for the requested timestamp
	while (buffer[idx].timestamp < timestamp) {
		idx++;
	}

	var frames = [buffer[idx]];

	// if multiple frames were requested
	if (length) {
		idx++;
		// run through the buffer and collect all frames, that have a timestamp
		// in the requested time frame
		while (buffer[idx].timestamp < (timestamp + length * 1000)) {
			frames.push(buffer[idx]);
			idx++;
		}
	}

	return frames;
}

function getIndexKey(timestamp) {
	return Math.floor(timestamp / indexPrecision) * indexPrecision;
}



// --- Exported functions ---

module.exports = {
	recordFrame: recordFrame,
	getFrames: getFrames
}