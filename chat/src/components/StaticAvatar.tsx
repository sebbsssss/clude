import { memo } from 'react';

interface Props {
  size?: number;
}

/**
 * CSS-only recreation of the LiquidMetal avatar.
 * Blue radial gradient + frosted glass overlay + decorative dots.
 * Zero GPU cost — used for all settled assistant messages.
 */
export const StaticAvatar = memo(function StaticAvatar({ size = 24 }: Props) {
  const innerSize = size === 24 ? 20 : 32;
  const dotSize = size === 24 ? '1px' : '1.5px';

  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0 mt-0.5"
      style={{ width: size, height: size }}
    >
      {/* Frosted glass overlay with dots */}
      <div
        className="z-10 absolute bg-white/5 rounded-full backdrop-blur-[2px]"
        style={{
          height: innerSize,
          width: innerSize,
          backdropFilter: size > 24 ? 'blur(3px)' : 'blur(2px)',
        }}
      >
        {size > 24 ? (
          <>
            <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-3 left-3 blur-[0.8px]" />
            <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-2 left-5 blur-[0.6px]" />
            <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-6 left-1.5 blur-[0.8px]" />
            <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-4 left-6.5 blur-[0.6px]" />
            <div className="h-[1.5px] w-[1.5px] bg-white rounded-full absolute top-5.5 left-5 blur-[0.8px]" />
          </>
        ) : (
          <>
            <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-1.5 left-1.5 blur-[0.5px]" />
            <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-1 left-3 blur-[0.4px]" />
            <div style={{ height: dotSize, width: dotSize }} className="bg-white rounded-full absolute top-3 left-1 blur-[0.5px]" />
          </>
        )}
      </div>

      {/* Static blue gradient — replaces LiquidMetal WebGL shader */}
      <div
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          background: 'radial-gradient(circle at 40% 35%, hsl(220, 100%, 55%), hsl(220, 100%, 30%) 50%, hsl(220, 80%, 15%) 100%)',
          filter: `blur(${size === 24 ? 3 : 6}px)`,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: size,
          height: size,
          background: 'radial-gradient(circle at 40% 35%, hsl(220, 100%, 55%), hsl(220, 100%, 30%) 50%, hsl(220, 80%, 15%) 100%)',
        }}
      />
    </div>
  );
});
