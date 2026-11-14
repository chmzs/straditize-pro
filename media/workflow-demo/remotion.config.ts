import {Config} from '@remotion/cli/config';

// H.264 / 1080p30；CRF 控制文件体积（UI 截图内容压缩率高，22 足够清晰）
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setCodec('h264');
Config.setCrf(20);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
