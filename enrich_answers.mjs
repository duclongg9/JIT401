import fs from 'fs';
import path from 'path';
import KuroshiroPkg from 'kuroshiro';
import AnalyzerPkg from 'kuroshiro-analyzer-kuromoji';

const Kuroshiro = KuroshiroPkg.default || KuroshiroPkg;
const KuromojiAnalyzer = AnalyzerPkg.default || AnalyzerPkg;

async function run() {
    const kuroshiro = new Kuroshiro();
    await kuroshiro.init(new KuromojiAnalyzer());

    const rawData = JSON.parse(fs.readFileSync(path.resolve('data/data.json'), 'utf8'));
    let loaiMap = {};
    for (const bh of rawData) {
        if (!bh.danh_sach_cau_hoi) continue;
        let count = 0;
        for (const qa of bh.danh_sach_cau_hoi) {
            count++;
            const ID = `b${bh.bai_hoc}_q${count}`;
            loaiMap[ID] = qa.loai;
        }
    }

    const flashcards = JSON.parse(fs.readFileSync(path.resolve('public/flashcards.json'), 'utf8'));

    for (let f of flashcards) {
        f.type = loaiMap[f.id] === 'Đúng hay sai' ? 'TF' : 'MCQ';
        let ans = f.correct_answer;
        if (f.type === 'TF') {
             f.correct_answer_html = ans; 
        } else {
             try {
                f.correct_answer_html = await kuroshiro.convert(ans, { mode: "furigana", to: "hiragana" });
             } catch(e) {
                f.correct_answer_html = ans;
             }
        }
    }
    
    fs.writeFileSync(path.resolve('public/flashcards.json'), JSON.stringify(flashcards, null, 2));
    console.log("Done enriching answers");
}
run();
