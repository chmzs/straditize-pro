import {Img, staticFile, useCurrentFrame, interpolate} from 'remotion';
import type {ReactNode} from 'react';
import {CARD, COLORS, IMG} from '../theme';
import type {CamState} from '../lib/camera';

/**
 * 真界面截图卡。
 * 结构：卡片（定位于 1920×1080）→ 相机层（推近/平移）→ 素材 + 叠加层。
 * 叠加层（高亮框等）写在素材像素坐标系里，所以会跟着运镜一起走。
 */
export const Screen = ({
  src,
  cam,
  children,
}: {
  src: string;
  cam: CamState;
  children?: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: CARD.x,
        top: CARD.y,
        width: IMG.w,
        height: IMG.h,
        transformOrigin: '0 0',
        scale: String(CARD.scale),
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: `0 0 0 1px ${COLORS.hairline}, 0 34px 90px rgba(0,0,0,0.62), 0 0 90px rgba(34,211,238,${0.10 * appear})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: IMG.w,
          height: IMG.h,
          transformOrigin: '0 0',
          scale: String(cam.scale),
          translate: `${cam.tx}px ${cam.ty}px`,
        }}
      >
        <Img
          src={staticFile(`shots/${src}`)}
          style={{position: 'absolute', left: 0, top: 0, width: IMG.w, height: IMG.h}}
        />
        {children}
      </div>
    </div>
  );
};
