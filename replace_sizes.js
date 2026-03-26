const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

const targetDir = path.join(__dirname, 'src');

walkDir(targetDir, (filePath) => {
    if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('text-[10px]')) {
            const updated = content.replace(/text-\[10px\]/g, 'text-xs font-bold');
            fs.writeFileSync(filePath, updated, 'utf8');
            console.log('Updated:', filePath);
        }
    }
});
