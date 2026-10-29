// Demo build alias for @clerk/clerk-js: the demo never signs in, and this keeps
// the ~1.5 MB Clerk chunk out of site/demo/.
export class Clerk {
  constructor() {
    throw new Error('Sign-in is not part of the demo');
  }
}
