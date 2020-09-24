# Amazon Kinesis Video Streams WebRTC SDK for JavaScript

Performance Metrics Embedded Edition

The test page version is different from the [original](https://awslabs.github.io/amazon-kinesis-video-streams-webrtc-sdk-js/examples/index.html "original") KVS WebRTC test page.

The reason why we have this modified test page, is to render the performance metrics, while using Amazon KVS WebRTC for P2P connection. Most of your developer would like to know the stats while using Amazon KVS WebRTC, to make sure the current performance is matched the criteria they set.

## Getting Started

You can find the [WebRTC test page with metrics](https://fufu976.github.io/kvs-webrtc-demo/examples/) here, and start to test the WebRTC on the brouser.

What metrics are shown in the page
- Viewer Start Time: The time we start the viewer.
- Track Start Time: The time we received the video stream.
- Cummunication Time: The total time from viewer start until now.
- Frame per second
- Connection time: The time from trigger the viewer until we received the first frame.
- 2 Mins AVG FPS: The average FPS after two minutes since the track began.

## Installing

If you want to install the SDK into your own environment, please refer to the original AWS KVS WebRTC JS [installation guide](https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-js)

## License

This project is licensed under the [Apache-2.0 License](http://www.apache.org/licenses/LICENSE-2.0). See LICENSE.txt and NOTICE.txt for more information.
