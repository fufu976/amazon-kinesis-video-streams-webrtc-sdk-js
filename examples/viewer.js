/**
 * This file demonstrates the process of starting WebRTC streaming using a KVS Signaling Channel.
 */
const viewer = {};
var viewer_button_pressed = new Date();

async function startViewer(localView, remoteView, formValues, onStatsReport, onRemoteDataMessage) {
    viewer.localView = localView;
    viewer.remoteView = remoteView;
    viewer_button_pressed = new Date();
    console.log('[WebRTC] TEST STARTED: ', viewer_button_pressed);

    // Create KVS client
    console.log("[startViewer] endpoint: ", formValues.endpoint)
    const kinesisVideoClient = new AWS.KinesisVideo({
        region: formValues.region,
        accessKeyId: formValues.accessKeyId,
        secretAccessKey: formValues.secretAccessKey,
        sessionToken: formValues.sessionToken,
        endpoint: formValues.endpoint,
    });

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: formValues.channelName,
        })
        .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
    console.log('[VIEWER] Channel ARN: ', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.VIEWER,
            },
        })
        .promise();
    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    console.log('[VIEWER] Endpoints: ', endpointsByProtocol);

    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: formValues.region,
        accessKeyId: formValues.accessKeyId,
        secretAccessKey: formValues.secretAccessKey,
        sessionToken: formValues.sessionToken,
        endpoint: endpointsByProtocol.HTTPS,
    });

    // Get ICE server configuration
    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
        .getIceServerConfig({
            ChannelARN: channelARN,
        })
        .promise();
    const iceServers = [];
    if (!formValues.natTraversalDisabled && !formValues.forceTURN) {
        iceServers.push({ urls: `stun:stun.kinesisvideo.${formValues.region}.amazonaws.com:443` });
    }
    if (!formValues.natTraversalDisabled) {
        getIceServerConfigResponse.IceServerList.forEach(iceServer =>
            iceServers.push({
                urls: iceServer.Uris,
                username: iceServer.Username,
                credential: iceServer.Password,
            }),
        );
    }
    console.log('[VIEWER] ICE servers: ', iceServers);

    // Create Signaling Client
    viewer.signalingClient = new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: endpointsByProtocol.WSS,
        clientId: formValues.clientId,
        role: KVSWebRTC.Role.VIEWER,
        region: formValues.region,
        credentials: {
            accessKeyId: formValues.accessKeyId,
            secretAccessKey: formValues.secretAccessKey,
            sessionToken: formValues.sessionToken,
        },
    });

    const resolution = formValues.widescreen ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const constraints = {
        video: formValues.sendVideo ? resolution : false,
        audio: formValues.sendAudio,
    };
    const configuration = {
        iceServers,
        iceTransportPolicy: formValues.forceTURN ? 'relay' : 'all',
    };
    viewer.peerConnection = new RTCPeerConnection(configuration);
    if (formValues.openDataChannel) {
        viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
        viewer.peerConnection.ondatachannel = event => {
            event.channel.onmessage = onRemoteDataMessage;
        };
    }

    // Poll for connection stats
    viewer.peerConnectionStatsInterval = setInterval(() => viewer.peerConnection.getStats().then(onStatsReport), 1000);

    viewer.signalingClient.on('open', async () => {
        console.log('[VIEWER] Connected to signaling service');

        // Get a stream from the webcam, add it to the peer connection, and display it in the local view
        try {
            viewer.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log("[signalingClient][getUserMedia]...")
            counter = 0
            viewer.localStream.getTracks().forEach(track => {
                viewer.peerConnection.addTrack(track, viewer.localStream)
                console.log("[signalingClient][addTrack]...",counter++)
            });
            localView.srcObject = viewer.localStream;
        } catch (e) {
            console.error('[VIEWER] Could not find webcam');
            return;
        }

        // Create an SDP offer to send to the master
        console.log('[VIEWER] Creating SDP offer');
        await viewer.peerConnection.setLocalDescription(
            await viewer.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        if (formValues.useTrickleICE) {
            console.log('[VIEWER] Sending SDP offer');
            viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        }
        console.log('[VIEWER] Generating ICE candidates');
    });

    viewer.signalingClient.on('sdpAnswer', async answer => {
        // Add the SDP answer to the peer connection
        console.log('[VIEWER] Received SDP answer');
        await viewer.peerConnection.setRemoteDescription(answer);
    });

    viewer.signalingClient.on('iceCandidate', candidate => {
        // Add the ICE candidate received from the MASTER to the peer connection
        console.log('[VIEWER] Received ICE candidate');
        viewer.peerConnection.addIceCandidate(candidate);
    });

    viewer.signalingClient.on('close', () => {
        console.log('[VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', error => {
        console.error('[VIEWER] Signaling client error: ', error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
            console.log('[VIEWER] Generated ICE candidate');

            // When trickle ICE is enabled, send the ICE candidates as they are generated.
            if (formValues.useTrickleICE) {
                console.log('[VIEWER] Sending ICE candidate');
                viewer.signalingClient.sendIceCandidate(candidate);
            }
        } else {
            console.log('[VIEWER] All ICE candidates have been generated');

            // When trickle ICE is disabled, send the offer now that all the ICE candidates have ben generated.
            if (!formValues.useTrickleICE) {
                console.log('[VIEWER] Sending SDP offer');
                viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
            }
        }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', event => {
        console.log('[VIEWER] Received remote track');
        if (remoteView.srcObject) {
            return;
        }
        viewer.remoteStream = event.streams[0];
        remoteView.srcObject = viewer.remoteStream;
        console.log('[VIEWER] Start calculateStats');
        calculateStats();
    });

    console.log('[VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
}

function stopViewer() {
    console.log('[VIEWER] Stopping viewer connection');
    if (viewer.signalingClient) {
        viewer.signalingClient.close();
        viewer.signalingClient = null;
    }

    if (viewer.peerConnection) {
        viewer.peerConnection.close();
        viewer.peerConnection = null;
    }

    if (viewer.localStream) {
        viewer.localStream.getTracks().forEach(track => track.stop());
        viewer.localStream = null;
    }

    if (viewer.remoteStream) {
        viewer.remoteStream.getTracks().forEach(track => track.stop());
        viewer.remoteStream = null;
    }

    if (viewer.peerConnectionStatsInterval) {
        clearInterval(viewer.peerConnectionStatsInterval);
        viewer.peerConnectionStatsInterval = null;
    }

    if (viewer.localView) {
        viewer.localView.srcObject = null;
    }

    if (viewer.remoteView) {
        viewer.remoteView.srcObject = null;
    }

    if (viewer.dataChannel) {
        viewer.dataChannel = null;
    }
}

function sendViewerMessage(message) {
    if (viewer.dataChannel) {
        try {
            viewer.dataChannel.send(message);
        } catch (e) {
            console.error('[VIEWER] Send DataChannel: ', e.toString());
        }
    }
}

function calcDiffTimestamp2Sec(large, small) {
    var diffMs = (large - small); // milliseconds between now & Christmas
    var num = Number.parseFloat(diffMs).toFixed(2);
    var diffSec = Number.parseFloat(num / 1000).toFixed(2);
    return diffSec;
}

function calculateStats() {
    console.log("Start calculateStats...")
    video = document.getElementById("calc-stat-video");
    var decodedFrames = 0,
            droppedFrames = 0,
            startTime = new Date().getTime(),
            initialTime = new Date().getTime();

    var initialDate = new Date();
    var currentDate = new Date();
    var previousDate = new Date();
    //Results Param
    var connection_time = calcDiffTimestamp2Sec(initialDate.getTime(), viewer_button_pressed.getTime());
    var two_mins_avg_fps = 0;
    var int_communication_time = 0;
            

    window.setInterval(function(){

        //see if webkit stats are available; exit if they aren't
        if (!video.webkitDecodedFrameCount){
            console.log("Video FPS calcs not supported");
            return;
        }
        //get the stats
        else{
            currentDate = new Date();
            var currentTime = currentDate.getTime();
            var deltaTime = (currentTime - startTime) / 1000;
            var totalTime = (currentTime - initialTime) / 1000;

            // Calculate decoded frames per sec.
            var currentDecodedFPS  = (video.webkitDecodedFrameCount - decodedFrames) / deltaTime;
            var decodedFPSavg = video.webkitDecodedFrameCount / totalTime;
            decodedFrames = video.webkitDecodedFrameCount;

            // Calculate dropped frames per sec.
            var currentDroppedFPS = (video.webkitDroppedFrameCount - droppedFrames) / deltaTime;
            var droppedFPSavg = video.webkitDroppedFrameCount / totalTime;
            droppedFrames = video.webkitDroppedFrameCount;
            var communication_time = calcDiffTimestamp2Sec(currentTime, initialDate.getTime())
            int_communication_time = parseInt(communication_time);
            var html_str = "<table><tr><th>STATS</th></tr>" +
            "<tr><td>VIEWER Start:</td><td>" + viewer_button_pressed + "</td></tr>" +
            "<tr><td>TRACK Start :</td><td>" + initialDate + "</td></tr>" +
            "<tr><td>Communication Time(Sec):</td><td>" + int_communication_time + "</td></tr>" +
            "<tr><td>Frame Per Second:</td><td>" + decodedFPSavg.toFixed(2) + "</td></tr></table>" +  
            "<table><tr><th>Results</th></tr>" +
            "<tr><td>Connection Time(SEC):</td><td>" + connection_time + "</td></tr></table>";
            if( int_communication_time == 120 ) {
                two_mins_avg_fps = decodedFPSavg.toFixed(2);
            }
            if( int_communication_time >= 120 ) {
                html_str = html_str + "<table><tr><td>2 Mins Avg FPS:</td><td>" + two_mins_avg_fps + "</td></tr></table>";
            }
            //write the results to a table
            $("#webrtc-evaluation")[0].innerHTML =html_str; 

            //write the results to a table
            $("#stats")[0].innerHTML =
                    "<table><tr><th>Results</th></tr>" +
                    "<tr><td>Connection Time:</td><td>" + connection_time + "</td></tr>" +
                    "<tr><td>Frame Per Second:</td><td>" + decodedFPSavg.toFixed() + "</td></tr></table>" +
                    "<table><tr><th>TIME</th></tr>" +
                    "<tr><td>TEST  Start:</td><td>" + viewer_button_pressed + "</td></tr>" +
                    "<tr><td>TRACK Start:</td><td>" + initialTime + "</td></tr>" +
                    "<tr><td>Curr  Date</td><td>" + currentDate + "</td></tr>" +
                    "<tr><td>Curr  Time</td><td>" + currentTime + "</td></tr>" +
                    "<tr><td>Prev  Time</td><td>" + startTime + "</td></tr>" +
                    "<tr><td>Prev  Date</td><td>" + previousDate + "</td></tr></table>" +
                    "<table><tr><th>Type</th><th>Total</th><th>Avg</th><th>Current</th></tr>" +
                    "<tr><td>Decoded</td><td>" + decodedFrames + "</td><td>" + decodedFPSavg.toFixed() + "</td><td>" + currentDecodedFPS.toFixed()+ "</td></tr>" +
                    "<tr><td>Dropped</td><td>" + droppedFrames + "</td><td>" + droppedFPSavg.toFixed() + "</td><td>" + currentDroppedFPS.toFixed() + "</td></tr>" +
                    "<tr><td>All</td><td>" + (decodedFrames + droppedFrames) + "</td><td>" + (decodedFPSavg + droppedFPSavg).toFixed() + "</td><td>" + (currentDecodedFPS + currentDroppedFPS).toFixed() + "</td></tr></table>" +
                    "Camera resolution: " + video.videoWidth + " x " + video.videoHeight; 

            
            startTime = currentTime; 
            previousDate = currentDate;
        }
    }, 1000);
}
