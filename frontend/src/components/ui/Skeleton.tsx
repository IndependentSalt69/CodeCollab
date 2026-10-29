import React from 'react';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  style?: React.CSSProperties;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '20px',
  borderRadius = 'var(--radius-sm)',
  style,
  className = '',
}) => {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: 'var(--bg-elevated)',
        backgroundImage: 'linear-gradient(90deg, var(--bg-elevated) 0%, rgba(255, 255, 255, 0.05) 50%, var(--bg-elevated) 100%)',
        backgroundSize: '200% 100%',
        animation: 'skeletonShimmer 1.5s infinite',
        ...style,
      }}
    />
  );
};

export default Skeleton;
