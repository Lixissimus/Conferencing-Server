var fs = require('fs');

var streamBuffers = {};
var bufferIndexes = {};
var recordingDirs = {};

// the bigger the number, the less index entries are created
var indexPrecision = 10000;

var recordingDir = './rec';

function newStream(streamId) {
	console.log('Recorder: Creating new recording buffer for Stream %s', streamId);
	streamBuffers[streamId] = [];
	bufferIndexes[streamId] = {};
	recordingDirs[streamId] = false;

	fs.exists(recordingDir, function(exists) {
		if (!exists) {
			fs.mkdir(recordingDir, createStreamRecordingDir);
		} else {
			createStreamRecordingDir();
		}
	});

	function createStreamRecordingDir(then) {
		var streamRecordingDir = recordingDir + '/Stream-' + streamId;
		fs.mkdir(streamRecordingDir, function() {
			recordingDirs[streamId] = streamRecordingDir;
			if (then) then();
		});
	}

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
	var dir = recordingDirs[streamId];
	if (dir) {
		if (frame.type === 'image') {
			// record image file for frame

			var imageURL = frame.data;
			var imageData = imageURL.split(',')[1];
			var buffer = new Buffer(imageData, 'base64');
			// fs.writeFile('images/data' + getCounter() + '.webp', buffer);

			fs.writeFile(dir + '/' + frame.timestamp + '.webp', buffer, function(err) {
				if (err) console.log(err);
			});
		}
	}
}


function getDurationOfFrames(streamId, timestamp, length) {
	// return an array of frames from timestamp for a timespan
	// of length seconds, or just one frame, if length not given

	var buffer = streamBuffers[streamId];

	// if no timestamp given, take the one from the first recoded frame
	if (timestamp === null || timestamp === undefined) {
		timestamp = buffer[0].timestamp;
	} else if (timestamp < buffer[0].timestamp) {

		timestamp = buffer[0].timestamp;
	}

	// if length equals 'all' or the requested length exceeds the stream length, 
	// set it to the max available length
	if (length === 'all' || timestamp + (length * 1000) > buffer[buffer.length - 1].timestamp) {
		length = (buffer[buffer.length - 1].timestamp - timestamp) / 1000;
	}

	var indexKey = getIndexKey(timestamp);
	var idx = bufferIndexes[streamId][indexKey];

	if (idx === undefined) {
		console.log('Recorder: Error while retrieving frame of Stream %s', streamId);
		return;
	}

	// From idx position in buffer, run through the buffer until we find
	// a frame, with a timestamp >= the one we are looking for.
	while (buffer[idx] && buffer[idx].timestamp < timestamp) {
		idx++;
	}

	var frames = [buffer[idx]];

	// if multiple frames were requested
	if (length) {
		idx++;
		// run through the buffer and collect all frames, that have a timestamp
		// in the requested time frame
		while (buffer[idx] && buffer[idx].timestamp < (timestamp + length * 1000)) {
			frames.push(buffer[idx]);
			idx++;
		}
	}

	return frames;
}

function getAmountOfFrames(streamId, before, amount) {
	// returns amount of the most recently recorded frames before the before-timestamp
	var buffer = streamBuffers[streamId];

	if (!before) {
		before = buffer[buffer.length-1].timestamp;
	}

	var indexKey = getIndexKey(before);
	var idx = bufferIndexes[streamId][indexKey];

	while (buffer[idx] && buffer[idx].timestamp <= before) {
		idx++;
	}
	idx--;

	if (!amount || amount > idx) {
		amount = idx;
	}

	return buffer.slice(idx - amount, idx);
}

function getIndexKey(timestamp) {
	return Math.floor(timestamp / indexPrecision) * indexPrecision;
}



// --- Exported functions ---

module.exports = {
	recordFrame: recordFrame,
	getDurationOfFrames: getDurationOfFrames,
	getAmountOfFrames: getAmountOfFrames
}