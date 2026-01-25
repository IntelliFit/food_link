// 使用 sharp 将 SVG 转换为 PNG
// 运行: npm install sharp && node convert-icons-sharp.js

const fs = require('fs');
const path = require('path');

async function convertIcons() {
  try {
    // 检查是否安装了 sharp
    const sharp = require('sharp');
    
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
    
    // 确保输出目录存在
    if (!fs.existsSync('assets/icons')) {
      fs.mkdirSync('assets/icons', { recursive: true });
    }
    
    for (const icon of icons) {
      if (fs.existsSync(icon.svg)) {
        await sharp(icon.svg)
          .resize(81, 81)
          .png()
          .toFile(icon.png);
        console.log(`✓ 已转换: ${icon.svg} -> ${icon.png}`);
      } else {
        console.log(`✗ 文件不存在: ${icon.svg}`);
      }
    }
    
    console.log('\n所有图标转换完成！');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('请先安装 sharp: npm install sharp');
      console.log('然后运行: node convert-icons-sharp.js');
    } else {
      console.error('转换失败:', error.message);
    }
  }
}

convertIcons();

