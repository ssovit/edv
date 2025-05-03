import axios from "axios";
import fs from "fs";
import path from "path";
import PDF from "pdf-parse/lib/pdf-parse.js";
import puppeteer from "puppeteer";
import { timeout } from "puppeteer";

export default function runner(STATUS, INSTANCE_COUNT) {
  const pdfDirectory = `./pdf/${STATUS}`;
  const checkedDirectory = `./checked/${STATUS}`;
  const winnerDirectory = `./winner/${STATUS}`;

  const WordToNumber = {
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: 7,
    EIGHT: 8,
    NINE: 9,
    ZERO: 0,
  };

  const wordToNumber = (text) => {
    // Validate input: ensure text is a string and not empty
    if (typeof text !== "string" || text.trim() === "") {
      return null;
    }

    let result = text;
    // Iterate through each key in WordToNumber
    for (let word in WordToNumber) {
      // Create a case-insensitive regex for the word
      const regex = new RegExp(word, "gi");
      // Replace all occurrences of the word with its numerical value
      result = result.replace(regex, WordToNumber[word]);
    }

    return result;
  };
  async function clearCookies(page, cookieNames = []) {
    try {
      if (cookieNames.length === 0) {
        // Clearing all cookies
        await page.evaluate(() => {
          document.cookie.split(";").forEach((cookie) => {
            const name = cookie.split("=")[0].trim();
            document.cookie = `${name}=; expires=Thu, 02 Jan 2024 00:00:00 UTC; path=/;`;
          });
        });
      } else {
        // Clearing specific cookies
        await page.deleteCookie(...cookieNames);
      }

      // Cookies have been cleared successfully
      return true;
    } catch (error) {
      // An error occurred while clearing cookies
      console.error("Error clearing cookies:", error);
      return false;
    }
  }
  async function navigateWithRetry(page, url, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, {
          waitUntil: "networkidle2",
          //waitUntil: "domcontentloaded",
        });
        return true;
      } catch (error) {
        if (error.message.includes("net::ERR_CONNECTION_TIMED_OUT")) {
          console.log(`Retry ${i + 1}/${maxRetries} for ${url}`);
          continue;
        }
        throw error;
      }
    }
    console.log("Max retries reached, ignoring timeout.");
    return false;
  }
  async function processPDFFiles(pdfFiles) {
    const failedFiles = [];
    const browser = await puppeteer.launch({
      headless: false,
      //args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: null,
      //downloadPath: "./captcha",
    });
    let error_count=0;

    
    const page = await browser.newPage();
    //await page.goto("https://dvprogram.state.gov/ESC/Default.aspx");
    await navigateWithRetry(
      page,
      "https://dvprogram.state.gov/ESC/CheckStatus.aspx",
    );

    await page.waitForNavigation({
      timeout: 30 * 1000,
    });
    for (const file of pdfFiles) {
      if(error_count>20){
        failedFiles.push(file);
        continue;
      }
      if (file.endsWith(".pdf")) {
        const pdfPath = path.join(pdfDirectory, file);
        console.log(`Checking : ${file}`);
        try {
          // Launch the browser
          const pdfData = await getTextFromPDF(pdfPath);
          await navigateWithRetry(
            page,
            "https://dvprogram.state.gov/ESC/CheckStatus.aspx",
          );

          // Extract data from PDF
          await fillFields(page, pdfData, browser);
          await fillCaptcha(page);
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
            console.log(`${file}- NOT SELECTED`);

            fs.renameSync(pdfPath, path.join(checkedDirectory, file));
          } else if (
            successText.includes(
              "You have been randomly selected for further processing",
            )
          ) {
            fs.copyFileSync(pdfPath, path.join(winnerDirectory, file));
            fs.renameSync(pdfPath, path.join(checkedDirectory, file));
            console.log(
              `----------------------------------------------------------`,
            );
            console.log(
              `${file}----------------------------------CONGRATS SELECTED`,
            );
            console.log(
              `----------------------------------------------------------`,
            );
          } else {
            failedFiles.push(file);
          }
        } catch (e) {
          //console.log(e)
          console.log(`Error Checking : ${file}`);
          failedFiles.push(file);
          //fs.renameSync(pdfPath, path.join(manualDirectory, file));
        }
        // clearCookies(page);
        await navigateWithRetry(
          page,
          "https://dvprogram.state.gov/ESC/CheckStatus.aspx",
        );

        //await page.goto("https://dvprogram.state.gov/ESC/CheckStatus.aspx");
      }
    }
    // Close the browser
    await browser.close();
    if (failedFiles.length > 0) {
      console.log(`${failedFiles.length} failed, restarting the thread`);
      processPDFFiles(failedFiles);
    }
  }
  const fillCaptcha = async (page) => {
    try {
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

      await page.type("#txtCodeInput", wordToNumber(captchaText.toUpperCase()));
    } catch (e) {
      await page.type("#txtCodeInput", "XXXX");
    }
  };
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
    } catch (e) {
      // console.log(e);
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
}
