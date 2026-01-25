// 将 SVG 图标转换为 PNG 的脚本
// 需要安装: npm install sharp

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// 如果 sharp 不可用，使用 canvas
async function convertSvgToPng(svgPath, pngPath) {
  try {
    // 读取 SVG 文件
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    
    // 创建 canvas
    const canvas = createCanvas(81, 81);
    const ctx = canvas.getContext('2d');
    
    // 注意：canvas 不能直接渲染 SVG，需要先转换为图片
    // 这里我们创建一个简单的占位符，实际应该使用 sharp 或其他工具
    
    // 设置背景为透明
    ctx.clearRect(0, 0, 81, 81);
    
    // 这里应该使用 SVG 渲染库，但为了简单，我们创建一个说明
    console.log(`需要转换: ${svgPath} -> ${pngPath}`);
    console.log('请使用在线工具或 sharp 库将 SVG 转换为 PNG (81x81px)');
    
  } catch (error) {
    console.error(`转换失败: ${error.message}`);
  }
}

// 图标列表
const icons = [
  { svg: 'src/assets/icons/home.svg', png: 'assets/icons/home.png' },
  { svg: 'src/assets/icons/home-active.svg', png: 'assets/icons/home-active.png' },
  { svg: 'src/assets/icons/community.svg', png: 'assets/icons/community.png' },
  { svg: 'src/assets/icons/community-active.svg', png: 'assets/icons/community-active.png' },
  { svg: 'src/assets/icons/record.svg', png: 'assets/icons/record.png' },
  { svg: 'src/assets/icons/record-active.svg', png: 'assets/icons/record-active.png' },
  { svg: 'src/assets/icons/ai-assistant.svg', png: 'assets/icons/ai-assistant.png' },
  { svg: 'src/assets/icons/ai-assistant-active.svg', png: 'assets/icons/ai-assistant-active.png' },
  { svg: 'src/assets/icons/profile.svg', png: 'assets/icons/profile.png' },
  { svg: 'src/assets/icons/profile-active.svg', png: 'assets/icons/profile-active.png' }
];

console.log('图标转换脚本');
console.log('请使用以下方法之一将 SVG 转换为 PNG:');
console.log('1. 使用在线工具: https://convertio.co/zh/svg-png/');
console.log('2. 使用 sharp: npm install sharp && node convert-icons-sharp.js');
console.log('3. 使用 ImageMagick: convert -background none -size 81x81 icon.svg icon.png');

