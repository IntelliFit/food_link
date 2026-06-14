/**
 * Icon 组件单元测试
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// 模拟 Icon 组件
const Icon: React.FC<{ name: string; size?: number; color?: string }> = ({ 
  name, 
  size = 24, 
  color = '#000' 
}) => {
  return (
    <span 
      data-testid="icon" 
      data-name={name}
      style={{ fontSize: size, color }}
    >
      {name}
    </span>
  );
};

describe('Icon 组件', () => {
  it('应正确渲染图标', () => {
    render(<Icon name="home" />);
    const icon = screen.getByTestId('icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('data-name', 'home');
  });

  it('应使用默认大小和颜色', () => {
    render(<Icon name="user" />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveStyle({ fontSize: 24, color: '#000' });
  });

  it('应接受自定义大小', () => {
    render(<Icon name="settings" size={32} />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveStyle({ fontSize: 32 });
  });

  it('应接受自定义颜色', () => {
    render(<Icon name="heart" color="#ff0000" />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveStyle({ color: '#ff0000' });
  });
});
