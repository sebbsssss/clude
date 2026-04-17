import { Composition } from 'remotion';
import { MainVideo } from './MainVideo';
import { HeroCut } from './HeroCut';

export const RemotionRoot = () => (
  <>
    <Composition
      id="MainVideo"
      component={MainVideo}
      durationInFrames={30 * 120}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="HeroCut"
      component={HeroCut}
      durationInFrames={30 * 60}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
