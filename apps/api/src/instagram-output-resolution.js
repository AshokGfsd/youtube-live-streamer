// Output resolution is independent of the X11/Chrome capture dimensions.
// Portrait sizes are even for H.264 yuv420p and include a practical 480p size.
export const STREAM_OUTPUT_SIZES = Object.freeze({
  source: null,
  '360x640': Object.freeze({ width: 360, height: 640 }),
  '480x854': Object.freeze({ width: 480, height: 854 }),
  '540x960': Object.freeze({ width: 540, height: 960 }),
  '720x1280': Object.freeze({ width: 720, height: 1280 }),
  '1080x1920': Object.freeze({ width: 1080, height: 1920 }),
});

export function streamOutputDimensions(settings) {
  return STREAM_OUTPUT_SIZES[settings.streamResolution || 'source'] || {
    width: settings.captureWidth,
    height: settings.captureHeight,
  };
}
