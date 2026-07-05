// Small shared helpers.

// Format a duration in seconds as MM:SS.
export function fmt(sec){
  var m = (sec / 60) | 0, s = (sec % 60) | 0;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
