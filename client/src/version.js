// Bumped by hand with each deploy so the hamburger menu always shows which build is
// actually running -- a Railway remote build has no reliable access to this repo's git
// history, so a build-time git-hash injection can't be trusted here.
//
// Semver convention for this project: X.Y.Z
//   Z (patch, e.g. 1.0.0 -> 1.0.1): small fixes/tweaks
//   Y (minor, e.g. 1.0.1 -> 1.1.0): larger changes (a real feature, a meaningful fix)
//   X (major, e.g. 1.1.0 -> 2.0.0): big changes
export const APP_VERSION = '1.13.1';
