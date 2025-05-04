import axios from "axios";
import fs from "fs";
import path from "path";
import PDF from "pdf-parse/lib/pdf-parse.js";
import puppeteer from "puppeteer";

export default function runner(STATUS, INSTANCE_COUNT) {
  const pdfDir = `./pdf/${STATUS}`;
  const checkedDir = `./checked/${STATUS}`;
  const winnerDir = `./winner/${STATUS}`;

  const WordToNumber = {
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: "7",
    EIGHT: "8",
    NINE: "9",
    ZERO: "0",
  };

  const wordToNumber = (text = "") =>
    Object.entries(WordToNumber).reduce(
      (acc, [word, digit]) => acc.replace(new RegExp(word, "gi"), digit),
      text,
    );

  async function navigateWithRetry(page, url, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, { waitUntil: "networkidle2" });
        return true;
      } catch (error) {
        if (error.message.includes("net::ERR_CONNECTION_TIMED_OUT")) {
          // logger.error(`Retrying navigation (${i + 1}/${maxRetries})...`);
        } else {
          throw error;
        }
      }
    }
    // logger.error("Max retries reached, skipping navigation.");
    return false;
  }

  async function extractPdfText(pdfPath) {
    const buffer = fs.readFileSync(pdfPath);
    const data = await PDF(buffer);
    return data.text.replace(/\n/g, " ").replace(/\s+/g, " ");
  }

  async function fillFormFields(page, pdfText) {
    const conf = pdfText.match(/Confirmation Number\s*:\s*(\S+)/i);
    const lastName = pdfText.match(/Entrant Name\s*:\s*([a-zA-Z0-9 ]+),/i);
    const year = pdfText.match(/Year of Birth\s*:\s*(\d+)/i);

    if (!conf || !lastName || !year)
      throw new Error("Missing required PDF data");

    await page.type("#txtCN", conf[1].trim());
    await page.type("#txtLastName", lastName[1].trim());
    await page.type("#txtYOB", year[1].trim());
    await page.focus("#txtCodeInput");

    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  }
  async function isCaptchaSolved(page) {
    try {
      const resultText = await page.$eval(
        "#ValidatorCaptchaAllCS",
        (el) => el.innerText,
      );
      if (resultText.includes("code as you see or hear it")) {
        return false;
      }
    } catch (err) {}
    return true;
  }
  async function solveCaptcha(page) {
    try {
      //console.log("solving captcha");
      const base64Audio = await page.evaluate(async () => {
        const el = document.querySelector(
          "#c_checkstatus_uccaptcha30_SoundLink",
        );
        if (!el) return null;
        const url = "https://dvprogram.state.gov" + el.getAttribute("href");
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
      });

      if (!base64Audio) throw new Error("No audio found");

      const audioBuffer = Buffer.from(base64Audio, "base64");
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer]));
      formData.append("model", "whisper-1");
      formData.append("response_format", "text");

      const { data: rawCaptcha } = await axios.post(
        "http://127.0.0.1:8000/v1/audio/transcriptions",
        formData,
      );
      const sanitized = rawCaptcha.replace(/[^a-zA-Z0-9]/g, "").trim();
      await page.type("#txtCodeInput", wordToNumber(sanitized.toUpperCase()));
      //await page.type("#txtCodeInput", "XXXX");
    } catch (err) {
      console.log(e);
      //logger.warn(`Captcha solve failed: ${err.message}`);
      await page.type("#txtCodeInput", "XXXX");
    }
    try {
      const [response] = await Promise.all([
        page.waitForNavigation({ timeout: 5000 }),
        page.click("#btnCSubmit"),
      ]);
      if (!(await isCaptchaSolved(page))) {
        return await solveCaptcha(page);
      }
    } catch (err) {}
    return true;
  }

  async function processPDFFiles(pdfFiles) {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
    });
    const page = await browser.newPage();
    const failed = [];
    let errorCount = 0;
    await navigateWithRetry(
      page,
      "https://dvprogram.state.gov/ESC/Default.aspx",
    );
    // await page.waitForNavigation({ timeout: 30000 });

    for (const file of pdfFiles) {
      if (!file.endsWith(".pdf")) continue;
      if (errorCount > 10) {
        failed.push(file);
        continue;
      }
      await navigateWithRetry(
        page,
        "https://dvprogram.state.gov/ESC/CheckStatus.aspx",
      );

      const filePath = path.join(pdfDir, file);
      // logger.info(`Checking: ${file}`);

      try {
        const pdfText = await extractPdfText(filePath);
        await fillFormFields(page, pdfText);
        await solveCaptcha(page);
        const resultText = await page.$eval("#main", (el) => el.innerText);
        if (resultText.includes("HAS NOT BEEN SELECTED")) {
          console.log(`❌ NOT SELECTED - ${file} ❌`);
          fs.renameSync(filePath, path.join(checkedDir, file));
        } else if (resultText.includes("randomly selected")) {
          fs.copyFileSync(filePath, path.join(winnerDir, file));
          fs.renameSync(filePath, path.join(checkedDir, file));
          console.log(`🎉👏👏👏 SELECTED - ${file} 👏👏👏 🎉`);
        } else {
          failed.push(file);
        }
      } catch (err) {
        failed.push(file);
        errorCount++;
      }
      try {
        await navigateWithRetry(
          page,
          "https://dvprogram.state.gov/ESC/Default.aspx",
        );
      } catch (err) {}
    }

    await browser.close();

    if (failed.length) {
      processPDFFiles(failed);
    }
  }

  function chunkArray(array, chunkCount) {
    const chunks = Array.from({ length: chunkCount }, () => []);
    array.forEach((item, i) => chunks[i % chunkCount].push(item));
    return chunks;
  }

  async function processAll() {
    const allFiles = fs.readdirSync(pdfDir).filter((f) => f.endsWith(".pdf"));
    if (!allFiles.length) return console.log(`✅ All ${STATUS} PDFs processed`);

    const chunks =
      allFiles.length > INSTANCE_COUNT
        ? chunkArray(allFiles, INSTANCE_COUNT)
        : [allFiles];

    for (const chunk of chunks) {
      processPDFFiles(chunk);
    }
  }
  processAll();
}
