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
const https = require('https');
const url = require('url');
const protooServer = require('protoo-server');
const mediasoup = require('mediasoup');
const readline = require('readline');
var path = require('path');
const colors = require('colors/safe');
const repl = require('repl');
const Logger = require('./lib/Logger');
const Room = require('./lib/Room');
var express = require('express');
const basicAuth = require('express-basic-auth')

var realm = require('express-http-auth').realm('Medisaoup');

var checkUser = function(req, res, next) {
  if (req.username == config.basicAuth.username && req.password == config.basicAuth.password) {
    next();
  } else {
    res.send(403);
  }
}

var auth = [realm, checkUser];

const app = express();


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


const httpsServer = https.createServer(tls, app);

httpsServer.listen(config.serverPort, 'localhost', () =>
{
	logger.info('protoo WebSocket server running');
});


app.get('/stats', auth, function (req, res) {
  const params = [];

  let data = Array.from(rooms, ([k,v]) => v);

  let total_peer_count = 0;
  params['rooms'] = data.map(x => {
  	  let peers = x._mediaRoom.peers
	  return {
	  	roomId: x._roomId,
	  	peers: peers.map(p => {
	  		total_peer_count++;
	  		let producers = Array.from(p._producers, ([k,v]) => v);
	  		// console.log(producers)
	  		return  {
	  			name:p._internal.peerName,
	  			device:{
	  				name:p._appData.device.name,
	  				version:p._appData.device.version
	  			},
	  			producers: producers.map(producer => {
	  				if (!producer._data.transport.iceSelectedTuple){
		  				return  {
		  					type:producer._appData.source,
		  				}
		  			}
	  				return {
	  					type:producer._appData.source,
	  					ice: {
	  						localIP:producer._data.transport.iceSelectedTuple.localIP,
	  						localPort: producer._data.transport.iceSelectedTuple.localPort,
	  						protocol: producer._data.transport.iceSelectedTuple.protocol,
	  						remoteIP: producer._data.transport.iceSelectedTuple.remoteIP,
	  						remotePort: producer._data.transport.iceSelectedTuple.remotePort,
	  						state: producer._data.transport.iceState
	  					}
	  				}
	  			})
	  		}
	  	})
	  }
  })

  params['total_peer_count'] = total_peer_count;

  res.render('stats', params);
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

		room.on('close', () =>
		{
			rooms.delete(roomId);
			clearInterval(logStatusTimer);
		});
	}
	else
	{
		room = rooms.get(roomId);
	}

	const transport = accept();

	room.handleConnection(peerName, transport);
});

// Listen for keyboard input.

let cmd;
let terminal;

openCommandConsole();

function openCommandConsole()
{
	stdinLog('[opening Readline Command Console...]');

	closeCommandConsole();
	closeTerminal();

	cmd = readline.createInterface(
		{
			input  : process.stdin,
			output : process.stdout
		});

	cmd.on('SIGINT', () =>
	{
		process.exit();
	});

	readStdin();

	function readStdin()
	{
		cmd.question('cmd> ', (answer) =>
		{
			switch (answer)
			{
				case '':
				{
					readStdin();
					break;
				}

				case 'h':
				case 'help':
				{
					stdinLog('');
					stdinLog('available commands:');
					stdinLog('- h,  help          : show this message');
					stdinLog('- sd, serverdump    : execute server.dump()');
					stdinLog('- rd, roomdump      : execute room.dump() for the latest created mediasoup Room');
					stdinLog('- pd, peerdump      : execute peer.dump() for the latest created mediasoup Peer');
					stdinLog('- td, transportdump : execute transport.dump() for the latest created mediasoup Transport');
					stdinLog('- prd, producerdump : execute producer.dump() for the latest created mediasoup Producer');
					stdinLog('- cd, consumerdump : execute consumer.dump() for the latest created mediasoup Consumer');
					stdinLog('- t,  terminal      : open REPL Terminal');
					stdinLog('');
					readStdin();

					break;
				}
				case 'sd':
					break;
				case 'serverdump':
				{
					mediaServer.dump()
						.then((data) =>
						{
							stdinLog(`server.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`mediaServer.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 'rd':
				case 'roomdump':
				{
					if (!global.ROOM)
					{
						readStdin();
						break;
					}

					global.ROOM.dump()
						.then((data) =>
						{
							stdinLog(`room.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`room.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 'pd':
				case 'peerdump':
				{
					if (!global.PEER)
					{
						readStdin();
						break;
					}

					global.PEER.dump()
						.then((data) =>
						{
							stdinLog(`peer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`peer.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 'td':
				case 'transportdump':
				{
					if (!global.TRANSPORT)
					{
						readStdin();
						break;
					}

					global.TRANSPORT.dump()
						.then((data) =>
						{
							stdinLog(`transport.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`transport.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 'prd':
				case 'producerdump':
				{
					if (!global.PRODUCER)
					{
						readStdin();
						break;
					}

					global.PRODUCER.dump()
						.then((data) =>
						{
							stdinLog(`producer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`producer.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 'cd':
				case 'consumerdump':
				{
					if (!global.CONSUMER)
					{
						readStdin();
						break;
					}

					global.CONSUMER.dump()
						.then((data) =>
						{
							stdinLog(`consumer.dump() succeeded:\n${JSON.stringify(data, null, '  ')}`);
							readStdin();
						})
						.catch((error) =>
						{
							stdinError(`consumer.dump() failed: ${error}`);
							readStdin();
						});

					break;
				}

				case 't':
				case 'terminal':
				{
					openTerminal();

					break;
				}

				default:
				{
					stdinError(`unknown command: ${answer}`);
					stdinLog('press \'h\' or \'help\' to get the list of available commands');

					readStdin();
				}
			}
		});
	}
}

function openTerminal()
{
	stdinLog('[opening REPL Terminal...]');

	closeCommandConsole();
	closeTerminal();

	terminal = repl.start(
		{
			prompt          : 'terminal> ',
			useColors       : true,
			useGlobal       : true,
			ignoreUndefined : false
		});
	terminal.context = global
	terminal.on('exit', () => openCommandConsole());
}

function closeCommandConsole()
{
	if (cmd)
	{
		cmd.close();
		cmd = undefined;
	}
}

function closeTerminal()
{
	if (terminal)
	{
		terminal.removeAllListeners('exit');
		terminal.close();
		terminal = undefined;
	}
}

function stdinLog(msg)
{
	// eslint-disable-next-line no-console
	console.log(colors.green(msg));
}

function stdinError(msg)
{
	// eslint-disable-next-line no-console
	console.error(colors.red.bold('ERROR: ') + colors.red(msg));
}
