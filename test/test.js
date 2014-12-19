var recorder = require('../recorder.js');
var assert = require('assert');

function setup() {
	for (var i = 0; i < 100; i++) {
		var frame = {
			streamId: 1,
			timestamp: i * 120,
			data: 'frame' + i
		}

		recorder.recordFrame(frame);
	}
}

function testGetFrame() {
	console.log('Running testGetFrame...');
	var timestamp = 300;

	var frames = recorder.getFrames(1, timestamp);
	
	assert.equal(frames.length, 1, 'Got more that 1 one, but requested just one');

	var frame = frames[0];

	assert.equal(frame.data, 'frame3', 'Expected frame3, got ' + frame.data + ' instead');
}

function testGetMultipleFrames() {
	console.log('Running testGetMultipleFrames...');
	var timestamp = 300;
	// 2 seconds
	var duration = 2;

	var frames = recorder.getFrames(1, timestamp, duration);

	assert.equal(frames.length, 17, 'Expected 17 frames, got ' + frames.length + ' instead');

	assert.equal(frames[0].data, 'frame3', 'Expected frame3, got ' + frames[0].data + ' instead')
	assert.equal(frames[16].data, 'frame19', 'Expected frame19, got ' + frames[16].data + ' instead')
}

setup();
testGetFrame();
testGetMultipleFrames();