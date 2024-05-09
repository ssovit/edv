import axios from "axios";
import fs from "fs";
import path from "path";
import { PdfReader } from "pdfreader";
import puppeteer from "puppeteer";
const pdfDirectory = "./pdf";
const checkedDirectory = "./checked";
const winnerDirectory = "./winner";
function randomStr(length=5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function processPDFFiles() {
  const files = fs.readdirSync(pdfDirectory);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--start-maximized"],
    defaultViewport: null,
    //downloadPath: "./captcha",
  });
  const page = await browser.newPage();

  for (const file of files) {
    if (file.endsWith(".pdf")) {
      const pdfPath = path.join(pdfDirectory, file);
      console.log(`Checking : ${file}`);
      // Launch the browser

      // Load the page where you'll fill the form
      await page.goto("https://dvprogram.state.gov/ESC/CheckStatus.aspx");
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
        timeout: 5 * 60 * 60 * 1000,
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
        console.log("----------------------------------SELECTED");
      }
    }
  }
  // Close the browser
  await browser.close();
}
const fillFields = async (page, text, browser) => {
  text = text.replace(/(\s+)/i, " ");
  const conf = text.match(/Confirmation Number(?:\s+)?:(?:\s+)?(.*)Year of Birth/i)[1];
  const lastName = text.match(
    /Entrant Name(?:\s+)?:(?:\s+)?([a-zA-Z0-9 ]+),/i,
  )[1];
  const year = text.match(/Year of Birth(?:\s+)?:(?:\s+)?(\d+)/i)[1];

  await page.type("#txtCN", conf.replace(/\s+/g,""));
  await page.type("#txtLastName", lastName);
  await page.type("#txtYOB", year);
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
    const response = await axios.get(audioUrl, { responseType: "arraybuffer" });
    //const fileData = Buffer.from(response.data, 'binary');

    const formData = new FormData();
    formData.append("file", new Blob([response.data]));
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");
    const captchaRes = await axios.post(
      "http://127.0.0.1:8000/v1/audio/transcriptions",
      formData,
    );
    const captchaText=captchaRes.data.replace(/[^a-zA-Z0-9]/g, "").replace(/\s+/g, "");
    await page.type(
      "#txtCodeInput",
      captchaText.toUpperCase()
    );
  } catch (e) {
    await page.type(
      "#txtCodeInput",
      randomStr()
    );
  }
};
const getTextFromPDF = async (pdfPath) => {
  return new Promise((resolve, reject) => {
    let text = "";
    new PdfReader().parseFileItems(pdfPath, (err, item) => {
      if (err) {
        reject(err);
      } else if (!item) {
        resolve(text);
      } else if (item.text) {
        text += item.text;
      }
    });
  });
};

processPDFFiles().then(() =>
  console.log("All PDF files processed successfully."),
);
