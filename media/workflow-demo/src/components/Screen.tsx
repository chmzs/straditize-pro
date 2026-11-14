import {Img, staticFile, useCurrentFrame, interpolate} from 'remotion';
import type {ReactNode} from 'react';
import {CARD, COLORS, H, IMG, W} from '../theme';
import type {CamState} from '../lib/camera';

/**
 * 真界面截图卡。
 * 结构：卡片（定位于 1920×1080）→ 缩放层 → 相机层（推近/平移）→ 素材 + 叠加层。
 * 叠加层写在**取景坐标系**里（默认 1440×900 原图，给了 crop 就是裁切区的本地坐标），
 * 所以会跟着运镜一起走。
 *
 * crop：只取原图的一块区域并竖排展示。用于「弹窗右栏」这类窄栏证据 ——
 * 与其把整张 1440×900 塞进画框、让空表占掉三分之一画面，不如把空表裁出画外。
 * 裁切只改变取景，不修改任何像素。
 */
export const Screen = ({
  src,
  cam,
  crop,
  cardHeight,
  children,
}: {
  src: string;
  cam: CamState;
  crop?: {x: number; y: number; w: number; h: number};
  /** 给了就把卡片做成该高度（像素），宽度按裁切比例算；否则用默认 1440×900 卡片。 */
  cardHeight?: number;
  children?: ReactNode;
}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const viewW = crop?.w ?? IMG.w;
  const viewH = crop?.h ?? IMG.h;
  const offsetX = crop?.x ?? 0;
  const offsetY = crop?.y ?? 0;

  const scale = cardHeight ? cardHeight / viewH : CARD.scale;
  const cardW = viewW * scale;
  const cardH = viewH * scale;
  const left = cardHeight ? (W - cardW) / 2 : CARD.x;
  // 裁切卡片贴着上沿放，给底部字幕带留出干净的空档
  const top = cardHeight ? 44 : CARD.y;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: cardW,
        height: cardH,
        transformOrigin: '0 0',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: `0 0 0 1px ${COLORS.hairline}, 0 34px 90px rgba(0,0,0,0.62), 0 0 90px rgba(34,211,238,${0.1 * appear})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: viewW,
          height: viewH,
          transformOrigin: '0 0',
          scale: String(scale),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: viewW,
            height: viewH,
            transformOrigin: '0 0',
            scale: String(cam.scale),
            translate: `${cam.tx}px ${cam.ty}px`,
          }}
        >
          <Img
            src={staticFile(`shots/${src}`)}
            style={{
              position: 'absolute',
              left: -offsetX,
              top: -offsetY,
              width: IMG.w,
              height: IMG.h,
            }}
          />
          {children}
        </div>
      </div>
    </div>
  );
};
