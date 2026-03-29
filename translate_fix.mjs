import fs from 'fs';
import path from 'path';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    const data = JSON.parse(fs.readFileSync(path.resolve('public/flashcards.json'), 'utf8'));
    for (let i = 0; i < data.length; i++) {
        try {
            // strip html tags to get plain string
            let plainJp = data[i].kanji_html.replace(/<[^>]+>/g, '');
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=vi&dt=t&q=${encodeURIComponent(plainJp)}`;
            const res = await fetch(url);
            const json = await res.json();
            let vi = "";
            if(json[0]) {
               json[0].forEach(p => vi += p[0]);
            }
            data[i].vietnamese_translation = vi;
            console.log(`Translated ${i}: ${vi}`);
        } catch(e) { 
            console.error(`Failed ${i}`) 
        }
        await delay(200);
    }
    fs.writeFileSync(path.resolve('public/flashcards.json'), JSON.stringify(data, null, 2));
    console.log("Done translating");
}

run();
