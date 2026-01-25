// 生成更大的 tabBar 图标 (120x120px)
// 运行: node convert-icons-larger.js

const fs = require('fs');
const sharp = require('sharp');

async function convertIconsLarger() {
  try {
    const icons = [
      { svg: 'src/assets/icons/home.svg', png: 'assets/icons/home.png', pngSrc: 'src/assets/icons/home.png' },
      { svg: 'src/assets/icons/home-active.svg', png: 'assets/icons/home-active.png', pngSrc: 'src/assets/icons/home-active.png' },
      { svg: 'src/assets/icons/community.svg', png: 'assets/icons/community.png', pngSrc: 'src/assets/icons/community.png' },
      { svg: 'src/assets/icons/community-active.svg', png: 'assets/icons/community-active.png', pngSrc: 'src/assets/icons/community-active.png' },
      { svg: 'src/assets/icons/record.svg', png: 'assets/icons/record.png', pngSrc: 'src/assets/icons/record.png' },
      { svg: 'src/assets/icons/record-active.svg', png: 'assets/icons/record-active.png', pngSrc: 'src/assets/icons/record-active.png' },
      { svg: 'src/assets/icons/ai-assistant.svg', png: 'assets/icons/ai-assistant.png', pngSrc: 'src/assets/icons/ai-assistant.png' },
      { svg: 'src/assets/icons/ai-assistant-active.svg', png: 'assets/icons/ai-assistant-active.png', pngSrc: 'src/assets/icons/ai-assistant-active.png' },
      { svg: 'src/assets/icons/profile.svg', png: 'assets/icons/profile.png', pngSrc: 'src/assets/icons/profile.png' },
      { svg: 'src/assets/icons/profile-active.svg', png: 'assets/icons/profile-active.png', pngSrc: 'src/assets/icons/profile-active.png' }
    ];
    
    // 确保输出目录存在
    if (!fs.existsSync('assets/icons')) {
      fs.mkdirSync('assets/icons', { recursive: true });
    }
    if (!fs.existsSync('src/assets/icons')) {
      fs.mkdirSync('src/assets/icons', { recursive: true });
    }
    
    for (const icon of icons) {
      // 检查是否有 SVG 源文件，如果没有则使用现有的 PNG
      if (fs.existsSync(icon.svg)) {
        await sharp(icon.svg)
          .resize(120, 120)
          .png()
          .toFile(icon.png);
        await sharp(icon.svg)
          .resize(120, 120)
          .png()
          .toFile(icon.pngSrc);
        console.log(`✓ 已生成大图标: ${icon.png} (120x120px)`);
      } else if (fs.existsSync(icon.png)) {
        // 如果 SVG 不存在，放大现有的 PNG
        await sharp(icon.png)
          .resize(120, 120)
          .png()
          .toFile(icon.pngSrc);
        console.log(`✓ 已放大图标: ${icon.pngSrc} (120x120px)`);
      } else {
        console.log(`✗ 文件不存在: ${icon.svg} 或 ${icon.png}`);
      }
    }
    
    console.log('\n所有大图标生成完成！');
  } catch (error) {
    console.error('转换失败:', error.message);
  }
}

convertIconsLarger();

