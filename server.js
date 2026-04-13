const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());

// 自動提供當前資料夾的檔案 (例如 index.html)
app.use(express.static(__dirname));

async function fetchHKJC(date, venue, raceno) {
    const formattedDate = date.replace(/-/g, '/');
    const url = `https://racing.hkjc.com/racing/information/Chinese/Racing/LocalResults.aspx?RaceDate=${formattedDate}&Racecourse=${venue}&RaceNo=${raceno}`;

    const resp = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(resp.data);
    const runnersMap = new Map();
    const dividends = { WIN: {}, PLA: {}, QIN: {}, QPL: {} };

    // 1. 抽取全場馬匹名單及真實獨贏賠率
    $('.performance tbody tr').each((i, el) => {
        const tds = $(el).find('td');
        if (tds.length >= 6) {
            const rank = $(tds[0]).text().trim();
            const noStr = $(tds[1]).text().trim();
            let name = $(tds[2]).text().trim().split('(')[0].replace(/[\r\n\t]/g, '').trim();

            let winOddsStr = '--';
            for (let c = tds.length - 1; c >= 3; c--) {
                const val = $(tds[c]).text().trim();
                if (val && !isNaN(parseFloat(val)) && !val.includes(':')) {
                    winOddsStr = val;
                    break;
                }
            }

            const no = parseInt(noStr);
            if (!isNaN(no) && !runnersMap.has(no)) {
                runnersMap.set(no, { rank, no, name, winOdds: parseFloat(winOddsStr) || 20.0 });
            }
        }
    });

    const runners = Array.from(runnersMap.values());

    // 2. 抽取真實派彩表
    let currentPool = '';
    $('.dividend_tab tbody tr').each((i, el) => {
        const cols = $(el).find('td');
        if (cols.length === 0) return;

        let poolStr = '', combHtml = '', divHtml = '';
        if (cols.length >= 3) {
            poolStr = $(cols[0]).text().trim();
            combHtml = $(cols[1]).html();
            divHtml = $(cols[2]).html();
            currentPool = poolStr;
        } else if (cols.length === 2) {
            combHtml = $(cols[0]).html();
            divHtml = $(cols[1]).html();
        }

        const poolKeyMap = { '獨贏': 'WIN', '位置': 'PLA', '連贏': 'QIN', '位置Q': 'QPL' };
        const pKey = poolKeyMap[currentPool];
        if (!pKey) return;

        const combs = (combHtml || '').replace(/<br\s*\/?>/gi, '|').replace(/<[^>]+>/g, '').split('|').map(s=>s.trim()).filter(Boolean);
        const divs = (divHtml || '').replace(/<br\s*\/?>/gi, '|').replace(/<[^>]+>/g, '').split('|').map(s=>s.trim()).filter(Boolean);

        for (let j = 0; j < Math.min(combs.length, divs.length); j++) {
            let c = combs[j].replace(/，/g, ',').replace(/-/g, ',');
            let d = parseFloat(divs[j].replace(/,/g, ''));
            if (isNaN(d)) continue;

            let odds = parseFloat((d / 10).toFixed(1));

            if (pKey === 'WIN' || pKey === 'PLA') {
                dividends[pKey][c] = odds;
            } else if (pKey === 'QIN' || pKey === 'QPL') {
                const parts = c.split(',').map(x => parseInt(x.trim())).sort((a,b)=>a-b);
                if (parts.length === 2) {
                    dividends[pKey][`${parts[0]}-${parts[1]}`] = odds;
                }
            }
        }
    });

    runners.sort((a,b) => a.no - b.no);
    return { runners, dividends };
}

app.get('/api/race', async (req, res) => {
    try {
        const { date = '2026-04-12', venue = 'ST', raceno = '2' } = req.query;
        const data = await fetchHKJC(date, venue, raceno);

        if (data.runners.length === 0) {
            return res.status(404).json({ error: '找不到賽果' });
        }

        const dateStr = date.replace(/-/g, '');
        const padNo = raceno.toString().padStart(2, '0');
        const rfStr = `http://racing.hkjc.com/zh-hk/local/information/localresults?racedate=${date.replace(/-/g,'/')}&Racecourse=${venue}&RaceNo=${raceno}&pageid=racing/local`;
        const videoUrl = `https://racing.hkjc.com/contentAsset/videoplayer_v4/video-player-iframe_v4.html?type=replay-full&date=${dateStr}&no=${padNo}&lang=chi&noPTbar=false&noLeading=false&videoParam=YD&rf=${encodeURIComponent(rfStr)}`;

        res.json({
            raceInfo: { date, venue, raceno, videoUrl },
            ...data
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// 當訪問首頁時，自動回傳 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 雲端平台會自動分配 PORT，所以不能寫死 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐎 雲端伺服器啟動，監聽 PORT: ${PORT}`));
