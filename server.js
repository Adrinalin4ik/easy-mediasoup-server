#!/usr/bin/env node

'use strict';

process.title = 'mediasoup-server';

const config = require('./config');

process.env.DEBUG = config.debug || '*INFO* *WARN* *ERROR*';

/* eslint-disable no-console */
console.log('- process.env.DEBUG:', process.env.DEBUG);
console.log('- config.mediasoup.logLevel:', config.mediasoup.logLevel);
console.log('- config.mediasoup.logTags:', config.mediasoup.logTags);
/* eslint-enable no-console */

const es6Renderer = require('express-es6-template-engine');
const fs = require('fs');
const http = require('http');
const url = require('url');
const protooServer = require('protoo-server');
const mediasoup = require('mediasoup');
const readline = require('readline');
const path = require('path');
const colors = require('colors/safe');
const repl = require('repl');
const Logger = require('./lib/Logger');
const Room = require('./lib/Room');
const express = require('express');
const basicAuth = require('express-basic-auth')
const cors = require('cors')
const Stats = require('./lib/Stats')



var realm = require('express-http-auth').realm('Mediasoup');

var checkUser = function(req, res, next) {
  if (req.username == config.basicAuth.username && req.password == config.basicAuth.password) {
    next();
  } else {
    res.send(403);
  }
}

var auth = [realm, checkUser];

const app = express();


app.use(express.static('public'));

app.set('views', path.join(__dirname, 'views'));
// app.engine('html', es6Renderer);
app.set('view engine', 'ejs')

const logger = new Logger();

// Map of Room instances indexed by roomId.
const rooms = new Map();

const stats = new Stats(rooms);

// mediasoup server.
const mediaServer = mediasoup.Server(
	{
		numWorkers       : config.mediasoup.numWorkers,
		logLevel         : config.mediasoup.logLevel,
		logTags          : config.mediasoup.logTags,
		rtcIPv4          : config.mediasoup.rtcIPv4,
		rtcIPv6          : config.mediasoup.rtcIPv6,
		rtcAnnouncedIPv4 : config.mediasoup.rtcAnnouncedIPv4,
		rtcAnnouncedIPv6 : config.mediasoup.rtcAnnouncedIPv6,
		rtcMinPort       : config.mediasoup.rtcMinPort,
		rtcMaxPort       : config.mediasoup.rtcMaxPort
	});

global.SERVER = mediaServer;

mediaServer.on('newroom', (room) =>
{
	global.ROOM = room;

	room.on('newpeer', (peer) =>
	{
		global.PEER = peer;

		if (peer.consumers.length > 0)
			global.CONSUMER = peer.consumers[peer.consumers.length - 1];

		peer.on('newtransport', (transport) =>
		{
			global.TRANSPORT = transport;
		});

		peer.on('newproducer', (producer) =>
		{
			global.PRODUCER = producer;
		});

		peer.on('newconsumer', (consumer) =>
		{
			global.CONSUMER = consumer;
		});
	});
});

// HTTPS server for the protoo WebSocjet server.
const tls =
{
	cert : fs.readFileSync(config.tls.cert),
	key  : fs.readFileSync(config.tls.key)
};


const httpsServer = http.createServer(app);

httpsServer.listen(config.serverPort, '0.0.0.0', () =>
{
	logger.info('protoo WebSocket server running');
});

app.get('/', function (req, res) {
	res.render("index");
})

app.post('/reload/room/:id', function (req, res) {
	try {
	let params = req.params;
	  console.log(params)
	  let room = rooms.get(params.id);
	  // room._mediaRoom.close()
	  // room._protooRoom.close()
	  // rooms.delete(params.id);
	  // room.close()
	} catch (err) {
		console.error(err)
	}
})

app.get('/stats', auth, function (req, res) {
	try {
	  const params = [];


	  let total_peer_count = 0;
	  params['rooms'] = stats.getRoomsData(rooms)

	  params['total_peer_count'] = total_peer_count;
	  params['stats'] = stats;
	  res.render('stats', params);
	} catch (err) {
		console.error(err)
	}
})

app.get('/download_test', cors({origin:"*"}), function (req, res) {
	const size = 200*1024//kb
	res.send(new Array(size*1024 + 1).join('a'))
})

app.post('/upload_test', cors({origin:"*"}), function (req, res) {
	res.send("OK")
})

//
// Protoo WebSocket server.
const webSocketServer = new protooServer.WebSocketServer(httpsServer,
	{
		maxReceivedFrameSize     : 960000, // 960 KBytes.
		maxReceivedMessageSize   : 960000,
		fragmentOutgoingMessages : true,
		fragmentationThreshold   : 960000,
		keepalive         		 : true,
		keepaliveInterval 		 : 60000
	});

// Handle connections from clients.
webSocketServer.on('connectionrequest', (info, accept, reject) =>
{
	// The client indicates the roomId and peerId in the URL query.
	const u = url.parse(info.request.url, true);
	const roomId = u.query['roomId'];
	const peerName = u.query['peerName'];

	if (!roomId || !peerName)
	{
		logger.warn('connection request without roomId and/or peerName');

		reject(400, 'Connection request without roomId and/or peerName');

		return;
	}

	logger.info(
		'connection request [roomId:"%s", peerName:"%s"]', roomId, peerName);

	let room;

	// If an unknown roomId, create a new Room.
	if (!rooms.has(roomId))
	{
		logger.info('creating a new Room [roomId:"%s"]', roomId);

		try
		{
			room = new Room(roomId, mediaServer);

			global.APP_ROOM = room;
		}
		catch (error)
		{
			logger.error('error creating a new Room: %s', error);

			reject(error);

			return;
		}

		// const logStatusTimer = setInterval(() =>
		// {
		// 	room.logStatus();
		// }, 30000);

		rooms.set(roomId, room);

		room.on('close', (room) =>
		{	
			// console.log("Room", room._mediaRoom.id)
			// const real_room_id = room._mediaRoom.id
			// console.log(mediaServer._workers)
			// mediaServer._workers.forEach((w, worker_index) => {
			// 	console.log(w)
			// 	w._rooms.forEach(r => {
			// 		if (r.id == real_room_id) {
			// 			console.warn("FOUND", r, w, w._rooms.size)
			// 			if (w._rooms.size == 1) {
			// 				room.closeConnections();
			// 				console.log("before romove", mediaServer)
			// 				console.log("After romove", mediaServer)
			// 				setTimeout(function() {
			// 					console.log("w status", w._child.killed)
			// 					// w.close()
			// 					w._child.kill('SIGHUP');
			// 					setTimeout(function() {
			// 						if (!w._child){
			// 							// mediaServer.createWorker(5);
			// 							console.log("Woker created")
			// 						}
			// 					},10000)
			// 				}, 3000)

			// 				console.log("Acter create worker", mediaServer)
			// 			}
			// 		}
			// 	})
			// })

			rooms.delete(roomId);
			// console.log(mediaServer)
			// clearInterval(logStatusTimer);
		});
	}
	else
	{
		room = rooms.get(roomId);
	}

	const transport = accept();

	room.handleConnection(peerName, transport);
});

/**
 * Generate blob with constatnt size
 * @param  {number} size Size in kilobytes
 * @return {blob}
 */
const generate_payload = async (size) => {
    return new Blob([new Array(size*1024 + 1).join('a')]);
}