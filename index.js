import axios from "axios";
import fs from "fs";
import path from "path";
import PDF from "pdf-parse/lib/pdf-parse.js";
import puppeteer from "puppeteer";

const INSTANCE_COUNT = 4;
const pdfDirectory = "./pdf";
const checkedDirectory = "./checked";
const winnerDirectory = "./winner";
function randomStr(length = 5) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function processPDFFiles(pdfFiles) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--start-maximized"],
    defaultViewport: null,
    //downloadPath: "./captcha",
  });
  const page = await browser.newPage();
  await page.goto("https://dvprogram.state.gov/");
  await page.waitForNavigation({
    timeout: 30 * 1000,
  });
  for (const file of pdfFiles) {
    if (file.endsWith(".pdf")) {
      const pdfPath = path.join(pdfDirectory, file);
      console.log(`Checking : ${file}`);
      try {
        // Launch the browser
        await page.goto("https://dvprogram.state.gov/ESC/CheckStatus.aspx");
        // Extract data from PDF
        const pdfData = await getTextFromPDF(pdfPath);
        await fillFields(page, pdfData, browser);

        //   // Add more fields as needed

        //   // Wait for user to review and submit the form
        //   await page.waitForSelector("#submit-button");
        //   await page.click("#submit-button");

        // Wait for post-submit page to load
        await page.evaluate(() => {
          document.querySelector("#btnCSubmit").click();
        });
        await page.waitForNavigation({
          timeout: 30 * 1000,
        });

        // Check if form submission was successful
        const successText = await page.evaluate(() => {
          return document.querySelector("#main").innerText;
        });

        if (successText.includes("HAS NOT BEEN SELECTED")) {
          fs.renameSync(pdfPath, path.join(checkedDirectory, file));
        } else if (
          successText.includes(
            "You have been randomly selected for further processing",
          )
        ) {
          fs.copyFileSync(pdfPath, path.join(winnerDirectory, file));
          fs.renameSync(pdfPath, path.join(checkedDirectory, file));
          console.log(`${file}----------------------------------SELECTED`);
        }
      } catch (e) {
        console.log(`Error Checking : ${file}`);
        //fs.renameSync(pdfPath, path.join(manualDirectory, file));
      }
    }
  }
  // Close the browser
  await browser.close();
}
const fillFields = async (page, text) => {
  try {
    const conf = text.match(
      /Confirmation Number(?:\s+)?:(?:\s+)?(.*)Year of Birth/i,
    );
    const lastName = text.match(
      /Entrant Name(?:\s+)?:(?:\s+)?([a-zA-Z0-9 ]+),/i,
    );
    const year = text.match(/Year of Birth(?:\s+)?:(?:\s+)?(\d+)/i);
    await page.type("#txtCN", conf[1].replace(/\s+/g, "").trim());
    await page.type("#txtLastName", lastName[1]);
    await page.type("#txtYOB", year[1]);
    await page.focus("#txtCodeInput");
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    try {
      const audioUrl = await page.evaluate(() => {
        const url =
          "https://dvprogram.state.gov" +
          document
            .querySelector("#c_checkstatus_uccaptcha30_SoundLink")
            .getAttribute("href");
        return url;
      });
      const base64Audio = await page.evaluate(async () => {
        const el = document.querySelector(
          "#c_checkstatus_uccaptcha30_SoundLink",
        );
        if (!el) return null;

        const url = "https://dvprogram.state.gov" + el.getAttribute("href");
        const response = await fetch(url);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        // Convert ArrayBuffer to base64
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary);
      });
      const audioBuffer = Buffer.from(base64Audio, "base64");

      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer]));
      formData.append("model", "whisper-1");
      formData.append("response_format", "text");
      const captchaRes = await axios.post(
        "http://127.0.0.1:8000/v1/audio/transcriptions",
        formData,
      );
      const captchaText = captchaRes.data
        .replace(/[^a-zA-Z0-9]/g, "")
        .replace(/\s+/g, "");
      await page.type("#txtCodeInput", captchaText.toUpperCase());
    } catch (e) {
      await page.type("#txtCodeInput", "XXXX");
    }
  } catch (e) {
    throw new Error("Error");
  }
};
const getTextFromPDF = async (pdfPath) => {
  return new Promise(async (resolve, reject) => {
    const dataBuffer = fs.readFileSync(pdfPath);
    PDF(dataBuffer).then((data) => {
      resolve(data.text.replace(/\n/g, " ").replace(/(\s+)/i, " "));
    });
  });
};
function chunkArray(items, chunkSize = 4) {
  const chunks = [];
  for (let i = 0; i < chunkSize; i++) {
    chunks[i] = [];
  }
  let j = 0;
  for (const item of items) {
    chunks[j].push(item);
    j++;
    if (j >= chunkSize) {
      j = 0;
    }
  }
  return chunks;
}
const processAll = () => {
  let files = fs.readdirSync(pdfDirectory);
  const filtered = files.filter((file) => file.endsWith(".pdf"));
  if (filtered.length > 0) {
    let chunks = [filtered];
    if (filtered.length > INSTANCE_COUNT) {
      chunks = chunkArray(filtered, INSTANCE_COUNT);
    }
    chunks.forEach((pdfFiles) => {
      processPDFFiles(pdfFiles);
    });
  } else {
    console.log("All Done");
  }
};
processAll();
