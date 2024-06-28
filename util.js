/**
 * Calculates the transcoding duration from startTime and endTime.
 * @param {Object} startTime - The start time of the transcoding job, with seconds and nanos properties.
 * @param {Object} endTime - The end time of the transcoding job, with seconds and nanos properties.
 * @returns {number} The duration of the transcoding in seconds.
 */
function calculateTranscodingDuration(startTime, endTime) {
    console.log('startTime:', startTime);
    console.log('endTime:', endTime);
    const startTimeInNanos = BigInt(startTime.seconds) * BigInt(1e9) + BigInt(startTime.nanos);
    const endTimeInNanos = BigInt(endTime.seconds) * BigInt(1e9) + BigInt(endTime.nanos);
    const durationInNanos = endTimeInNanos - startTimeInNanos;
    return Number(durationInNanos) / 1e9;
  }
  module.exports = { calculateTranscodingDuration };