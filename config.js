module.exports =
{
	// DEBUG env variable For the NPM debug module.
	stage: process.env.stage || "beta",
	serverPort: +process.env.serverPort || 3443,
	debug: process.env.logLevel || '*INFO* *WARN* *ERROR*',
	// Listening hostname for `gulp live|open`.
	domain: 'localhost',
	basicAuth: {
		username:process.env.basicAuthUsername || "admin",
		password:process.env.basicAuthPassword || "password",
	},
	tls: {
		cert: `${__dirname}/certs/mediasoup-demo.localhost.cert.pem`,
		key : `${__dirname}/certs/mediasoup-demo.localhost.key.pem`
	},
	numWorkers: +process.env.numWorkers || 4,

	send_active_speakers_time_interval: +process.env.send_active_speakers_time_interval || 2000,
	active_speaker_db_level: +process.env.active_speaker_db_level || -35,
	active_enable_check_active_speakers: process.env.active_enable_check_active_speakers || true,

	mediasoup: {
		// mediasoup Server settings.
		logLevel: 'debug',
		logTags: [
			'info',
			'ice' ,
			'dlts',
			'rtp' ,
			'srtp',
			'rtcp',
			'rbe' ,
			'rtx'
		],
		rtcIPv4          : true,
		rtcIPv6          : true,
		rtcAnnouncedIPv4 : null,
		rtcAnnouncedIPv6 : null,
		rtcMinPort       : 40000,
		rtcMaxPort       : 49999,
		// mediasoup Room codecs.
		mediaCodecs:[
			{
				kind       : 'audio',
				name       : 'opus',
				clockRate  : 48000,
				channels   : 2,
				parameters : {
					useinbandfec : 1
				}
			},
			{
				kind      : 'video',
				name      : 'VP8',
				clockRate : 90000
			}
			// {
			// 	kind       : 'video',
			// 	name       : 'H264',
			// 	clockRate  : 90000,
			// 	parameters :
			// 	{
			// 		'packetization-mode' : 1
			// 	}
			// }
		],
		// mediasoup per Peer max sending bitrate (in bps).
		maxBitrate: +process.env.maxBitrate || 250000,
	}
};
