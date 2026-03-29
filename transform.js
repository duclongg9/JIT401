import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const rawData = JSON.parse(fs.readFileSync('./data/data.json', 'utf8'));
const flashcards = [];

rawData.forEach(categoryData => {
    const category = categoryData.bai_hoc || 'JIT401';
    if (categoryData.danh_sach_cau_hoi) {
        categoryData.danh_sach_cau_hoi.forEach(qa => {
            flashcards.push({
                id: uuidv4(),
                kanji: qa.cau_hoi || '',
                furigana: '', // the JSON does not provide furigana, thus we leave it empty
                vietnamese: qa.dap_an_chinh_xac || '',
                mnemonic: qa.loai || '',
                category: category
            });
        });
    }
});

fs.writeFileSync('./public/flashcards.json', JSON.stringify(flashcards, null, 2), 'utf8');
console.log(`Generated ${flashcards.length} flashcards in public/flashcards.json`);
