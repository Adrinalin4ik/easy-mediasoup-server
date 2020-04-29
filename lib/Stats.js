'use strict';

const geoip = require('geoip-lite');
var ps = require('current-processes');
var pidusage = require('pidusage')
var os = require('os')
const axios = require('axios-https-proxy-fix').default;
const config = require('../config');
class Stats {
	constructor(rooms, mediaserver) {
		this.rooms = rooms;
		this.mediaserver = mediaserver;
		this.peerTimeData = [{x: new Date, y:0}];
		this.processResourcesUsage = [];
		this.peerDeviceData = {};
		this.saveStatsTime = 60*12 //хранить историю только за последние 12 часов
		this.cities = {};
		//start worker
		this.startWorker()
	}

	startWorker(){
		setInterval(()=> {
			try {
				this.processPeerDevices();
				this.processPeerTimeData();
				this.processServerInfo();
				this._peerCount = this.peerCount;
			} catch (err) {
				console.error(err)
			}
		}, 5*1000)
	}

	async getWorkerStat(pid, worker) {
		const stats = await pidusage(pid)
		const producers = this.calcWorkerProducers(worker);
		const consumers = this.calcWorkerConsumers(worker);

		if (config.telegram.enabled && stats.cpu > config.telegram.cpuNotificationTheshold) {
			
			let rooms = Array.from(worker._rooms.values()).map(r => {
				const room = Array.from(this.rooms.values())
				.find(r1 => r1._mediaRoom._internal.routerId === r._internal.routerId);
				if (room) {
					return `[${room._roomId}](${config.telegram.roomLink.replace('$roomId', room._roomId)})`
				}
			})

			await axios.request({
				url: `https://api.telegram.org/${config.telegram.botToken}/sendMessage`,
				method: 'post',
				params: {
					parse_mode: 'Markdown',
					chat_id: config.telegram.chatId,
					text: `⚠️ [${config.mediaserverName}](${config.telegram.warningLink}), worker pid: ${pid} has reached ${config.telegram.cpuNotificationTheshold}% CPU (${stats.cpu.toFixed(2)}%)
${rooms}
					`
				},
				headers: {'Content-Type': 'application/json'},
				timeout: 10000,
				proxy: {
					host: config.telegram.proxyHost,
					port: +config.telegram.proxyPort
				}
			})
		}
		return {
			pid: pid,
			cpu: stats.cpu.toFixed(2),
			mem: stats.memory,
			mem_percent:((stats.memory)/os.totalmem()*100).toFixed(2),
			room_count: worker._rooms.size,
			peer_count: Array.from(worker._rooms).reduce((acc, x) => { return acc += x._peers.size }, 0),
			audio_producers: producers.audio_producers,
			video_producers: producers.video_producers,
			video_consumers: consumers.video_consumers,
			audio_consumers: consumers.audio_consumers
		}
	}

	calcWorkerProducers(worker) {
		const result = {
			id: worker.id,
			audio_producers:0,
			video_producers:0
		}
		
		Array.from(worker._rooms).forEach(r => {
			r._peers.forEach(x => x._producers.forEach(producer => producer._data.kind === 'audio' ? result.audio_producers++ : result.video_producers++ ))
		})

		return result
	}

	calcWorkerConsumers(worker) {
		const result = {
			id: worker.id,
			audio_consumers:0,
			video_consumers:0
		}
		
		Array.from(worker._rooms).forEach(r => {
			r._peers.forEach(x => x._consumers.forEach(c => c._data.kind === 'audio' ? result.audio_consumers++ : result.video_consumers++ ))
		})

		return result
	}

	async processServerInfo(){
		// ps.get(function(err, processes) {
		//     console.log(processes.find());
		// });
		//
		const workersPromises = [];
		Array.from(this.mediaserver._workers).forEach((w) => {
			workersPromises.push(this.getWorkerStat(w._child.pid, w))
		})

		const workers = await Promise.all(workersPromises)

		const main_process = await pidusage(process.pid)

		this.processResourcesUsage.push({
			date: new Date,
			workers,
			stats:{
				cpu:Math.round(main_process.cpu,2),
				mem:((main_process.memory)/os.totalmem()*100).toFixed(2)
			}
		})

		if (this.processResourcesUsage.length > this.saveStatsTime) this.processResourcesUsage.splice(0,1)
		// => {
		//   727: {
		//     cpu: 10.0,            // percentage (from 0 to 100*vcore)
		//     memory: 357306368,    // bytes
		//     ppid: 312,            // PPID
		//     pid: 727,             // PID
		//     ctime: 867000,        // ms user + system time
		//     elapsed: 6650000,     // ms since the start of the process
		//     timestamp: 864000000  // ms since epoch
		//   },
		//   1234: {
		//     cpu: 0.1,             // percentage (from 0 to 100*vcore)
		//     memory: 3846144,      // bytes
		//     ppid: 727,            // PPID
		//     pid: 1234,            // PID
		//     ctime: 0,             // ms user + system time
		//     elapsed: 20000,       // ms since the start of the process
		//     timestamp: 864000000  // ms since epoch
		//   }
		// }
	}
	processPeerDevices(){
		let data = Array.from(this.rooms, ([k,v]) => v);
		data.forEach((x) => {
			let peers = x._mediaRoom.peers
			peers.forEach(peer => {
				const device_name = peer.appData.device.name+" "+peer.appData.device.version
				this.peerDeviceData[device_name] = this.peerDeviceData[device_name] || [];
				let current = this.peerDeviceData[device_name];
				if (!current.includes(peer.name)){
					this.peerDeviceData[device_name].push(peer.name)
				}
			})
		})
	}

	processPeerTimeData(){
			const date = new Date;
			this.peerTimeData.push({x: date, y:this.peerCount})
			if (this.peerTimeData.length > (this.saveStatsTime)) this.peerTimeData.splice(0,1)
	}

	get peerCount() {
		let data = Array.from(this.rooms, ([k,v]) => v);
		let count = 0;
		data.forEach((x) => {
			count += x._mediaRoom.peers.length;
		})
		return count;
	}

	getRoomsData(){
		let data = Array.from(this.rooms, ([k,v]) => v);
		return data.map(x => {
			const worker = Array.from(this.mediaserver._workers).find((w, worker_index) => {
				return Array.from(w._rooms).find(r => {
					return r.id == x._mediaRoom.id
				})
			})

			let workerStats;
			if (worker) {
				workerStats = {
					pid: worker._child.pid
				}
			}

			let peers = x._mediaRoom.peers
		  return {
				worker: workerStats,
		  	roomId: x._roomId,
		  	peers: peers.map(p => {
				  let producers = Array.from(p._producers, ([k,v]) => v);
		  		return  {
		  			name:p._internal.peerName,
		  			displayName:p._appData.displayName,
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
			  			let ip = producer._data.transport.iceSelectedTuple.remoteIP
			  			var geo = geoip.lookup(ip) || {};
			  			/*
			  				{ range: [ 3479297920, 3479301339 ],
							  country: 'US',
							  region: 'TX',
							  city: 'San Antonio',
							  ll: [ 29.4889, -98.3987 ],
							  metro: 641,
							  zip: 78218 }
			  			 */
			  			const city = geo.city
						this.cities[city] = this.cities[city] || [];
						let current = this.cities[city];
						if (!current.includes(ip)){
							this.cities[city].push(ip)
						}
		  				return {
		  					type:producer._appData.source,
		  					ice: {
		  						localIP:producer._data.transport.iceSelectedTuple.localIP,
		  						localPort: producer._data.transport.iceSelectedTuple.localPort,
		  						protocol: producer._data.transport.iceSelectedTuple.protocol,
		  						remoteIP: producer._data.transport.iceSelectedTuple.remoteIP,
		  						remotePort: producer._data.transport.iceSelectedTuple.remotePort,
		  						geoInfo: geo,
		  						state: producer._data.transport.iceState
		  					}
		  				}
		  			})
		  		}
		  	})
		  }
	  })
	}
}

module.exports = Stats;
