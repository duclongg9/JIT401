import fs from 'fs';
import path from 'path';
import { translate } from '@vitalets/google-translate-api';
import KuroshiroPkg from 'kuroshiro';
import AnalyzerPkg from 'kuroshiro-analyzer-kuromoji';

// Polyfill for ESM vs CJS default export issues
const Kuroshiro = KuroshiroPkg.default || KuroshiroPkg;
const KuromojiAnalyzer = AnalyzerPkg.default || AnalyzerPkg;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("Initializing Kuroshiro for Furigana generation...");
    const kuroshiro = new Kuroshiro();
    await kuroshiro.init(new KuromojiAnalyzer());
    
    console.log("Reading data.json...");
    const rawData = JSON.parse(fs.readFileSync(path.resolve('data/data.json'), 'utf8'));
    
    const output = [];
    let count = 0;
    
    for (const bh of rawData) {
        if (!bh.danh_sach_cau_hoi) continue;
        
        for (const qa of bh.danh_sach_cau_hoi) {
            count++;
            console.log(`Processing ${count}...`);
            const ID = `b${bh.bai_hoc}_q${count}`;
            const jpText = qa.cau_hoi;
            
            // Generate Furigana HTML
            let furiganaHtml = Object.assign({}, { html: jpText }).html;
            try {
                if (jpText) {
                    furiganaHtml = await kuroshiro.convert(jpText, { mode: "furigana", to: "hiragana" });
                }
            } catch (e) {
                console.error(`Furigana failed`);
            }

            // Generate Vietnamese Translation
            let viTranslation = "(Chưa thể dịch)";
            try {
                if(jpText) {
                    const res = await translate(jpText, { to: 'vi' });
                    viTranslation = res.text;
                    await delay(300); // Prevent ban
                }
            } catch (e) {
                 console.error(`Translation failed`);
                 viTranslation = qa.dap_an_chinh_xac || jpText; // Fallback
            }
            
            output.push({
                id: ID,
                category: `Bài ${bh.bai_hoc}`,
                kanji_html: furiganaHtml,
                vietnamese_translation: viTranslation,
                correct_answer: qa.dap_an_chinh_xac || jpText
            });
        }
    }
    
    fs.writeFileSync(path.resolve('public/flashcards.json'), JSON.stringify(output, null, 2));
    console.log("Transformation and Enrichment complete! Generated public/flashcards.json");
}

run();
