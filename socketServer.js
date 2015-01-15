var fs = require('fs');
var router = require('./router.js');
var logic = require('./logic.js');


// start socket server
var port = 1234;
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: port});

console.log('Server runnung on port %d...', port);


wss.on('connection', function(ws) {	
	ws.on('close', function() {
		logic.removeClient(ws);
	});
 
	ws.on('error', function(err) {
		console.log(err);
	});

	ws.on('message', function(message) {
		try {
			message = JSON.parse(message);
		} catch() {
			console.log('Error while parsing message');
			return;
		}

		// add a timestamp to each incoming message
		message.timestamp = Date.now();

		router.handleMessage(ws, message);
	});
});