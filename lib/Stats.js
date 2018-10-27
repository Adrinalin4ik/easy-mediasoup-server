'use strict';

const geoip = require('geoip-lite');
var ps = require('current-processes');
var pidusage = require('pidusage')
var os = require('os')

class Stats {
	constructor(rooms) {
		this.rooms = rooms;
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
		}, 60*1000)
	}

	processServerInfo(){
		// ps.get(function(err, processes) {
		//     console.log(processes.find());
		// });
		//

		pidusage(process.pid, (err, stats) => {
		  console.log(stats)
		  this.processResourcesUsage.push({
		  	date: new Date,
		  	stats:{
			  	cpu:Math.round(stats.cpu,2),
			  	mem:((stats.memory)/os.totalmem()*100).toFixed(2)
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
		})
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
	  	  let peers = x._mediaRoom.peers
		  return {
		  	roomId: x._roomId,
		  	peers: peers.map(p => {
		  		let producers = Array.from(p._producers, ([k,v]) => v);
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
