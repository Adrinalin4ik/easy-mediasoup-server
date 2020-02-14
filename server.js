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
const pidusage = require('pidusage')


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

mediaServer._workers.forEach((w) => {
	w.on('@close', () => {
		console.error("WORKER HAS BEEN CLOSED")
		// try {
		// 	console.log(mediaServer._workers)
		// 	Array.from(mediaServer._workers).forEach((w) => {
		// 		Array.from(w._rooms).forEach(r => {
		// 			const room = rooms.find(x => r.id == x._mediaRoom.id)
		// 			console.log(room)
		// 			room._mediaRoom.close()
		// 			room._protooRoom.close()
		// 			rooms.delete(params.id);
		// 			room.close()
		// 		})
		// 	})
		// } catch (ex) {
		// 	console.error(ex)
		// }
	})
})

let currentlessLoadedWorkerIndex = 0;

const setWorkerIndex = async () => {
	const worker = await findLessLoadedWorker();
	const maxIndex = mediaServer._workers.size;
	let result = worker.index - 1;
	if (result < 0) result = maxIndex - 1;
	currentlessLoadedWorkerIndex = result;
}

const findLessLoadedWorker = async () => {
	const workerLoadingsPromises = [];
	Array.from(mediaServer._workers).forEach((w, index) => {
		workerLoadingsPromises.push(getWorkerLoading(w, index))
	})
	const workerLoadings = await Promise.all(workerLoadingsPromises)
	const lessLoaded = workerLoadings.sort((x,y) => x.cpu - y.cpu)[0]

	return lessLoaded;
}

const getWorkerLoading = async (worker, index) => {
	const stats = await pidusage(worker._child.pid);
	return{
		index,
		// worker,
		pid: worker._child.pid,
		cpu: stats.cpu
	}
}

// setWorkerIndex();
// setInterval(async() => {
// 	await setWorkerIndex();
// }, 30000)


const stats = new Stats(rooms, mediaServer);

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
	logger.info(`protoo WebSocket server running on ${config.serverPort}`);
});

app.get('/', function (req, res) {
	res.render("index");
})

app.post('/reload/room/:id', function (req, res) {
	try {
		let params = req.params;
	  console.log(params)
	  let room = rooms.get(params.id);
	  room._mediaRoom.close()
	  room._protooRoom.close()
	  rooms.delete(params.id);
	  room.close()
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

app.get('/test', function (req, res) {
	try {
		const workers = [];
		
		Array.from(mediaServer._workers).forEach((w) => {
			const worker = {
				id: w.id,
				audio_producers:0,
				video_producers:0
			}
			
			Array.from(w._rooms).forEach(r => {
				r._peers.forEach(x => x._producers.forEach(producer => producer._data.kind === 'audio' ? worker.audio_producers++ : worker.video_producers++ ))
			})

			workers.push(worker)
		})

	  res.send(workers);
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
webSocketServer.on('connectionrequest', async (info, accept, reject) =>
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
		setWorkerIndex()
		mediaServer._latestWorkerIdx = currentlessLoadedWorkerIndex;
		console.log("Room created on worker", currentlessLoadedWorkerIndex)

		try
		{
			room = new Room(roomId, mediaServer);

			global.APP_ROOM = room;
			// console.log(room._mediaRoom)
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