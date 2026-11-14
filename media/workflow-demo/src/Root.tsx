import {Composition} from 'remotion';
import {Workflow} from './Workflow';
import {WorkflowCompact, GIF_TOTAL_FRAMES} from './WorkflowCompact';
import {FPS, H, W} from './theme';
import {TOTAL_FRAMES} from './scenario';

export const RemotionRoot = () => (
  <>
    {/* 长片：文档站 / 投稿用 */}
    <Composition
      id="Workflow8Steps"
      component={Workflow}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={W}
      height={H}
    />
    {/* 紧凑版：只为转网页动图，同样 8 步、同样真值，首尾暗场拍子保证 loop 无缝 */}
    <Composition
      id="Workflow8StepsCompact"
      component={WorkflowCompact}
      durationInFrames={GIF_TOTAL_FRAMES}
      fps={FPS}
      width={W}
      height={H}
    />
  </>
);
