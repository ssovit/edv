import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { PdfReader } from "pdfreader";
const pdfDirectory = "./pdf";
const successDirectory = "./winner";
const failureDirectory = "./losers";
const checkedDirectory = "./checked";

async function processPDFFiles() {
  const files = fs.readdirSync(pdfDirectory);

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--start-maximized"],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  for (const file of files) {
    if (file.endsWith(".pdf")) {
      const pdfPath = path.join(pdfDirectory, file);

      // Launch the browser

      // Load the page where you'll fill the form
      await page.goto("https://dvprogram.state.gov/ESC/CheckStatus.aspx");
      await page.goto("https://dvprogram.state.gov/ESC/CheckStatus.aspx");
      // Extract data from PDF
      const pdfData = await getTextFromPDF(pdfPath);
      await fillFields(page, pdfData);

      //   // Add more fields as needed

      //   // Wait for user to review and submit the form
      //   await page.waitForSelector("#submit-button");
      //   await page.click("#submit-button");

      // Wait for post-submit page to load
      await page.waitForNavigation({
        timeout: 5 * 60 * 60 * 1000,
      });

      // Check if form submission was successful
      const successText = await page.evaluate(() => {
        return document.querySelector("#main").innerText;
      });

      if (successText.includes("HAS NOT BEEN SELECTED")) {
        fs.copyFileSync(pdfPath, path.join(checkedDirectory, file));
        fs.renameSync(pdfPath, path.join(failureDirectory, file));
      } else if (
        successText.includes(
          "You have been randomly selected for further processing",
        )
      ) {
        fs.copyFileSync(pdfPath, path.join(checkedDirectory, file));
        fs.renameSync(pdfPath, path.join(successDirectory, file));
      }
    }
  }
  // Close the browser
  await browser.close();
}
const fillFields = async (page, text) => {
  text = text.replace(/(\s+)/i, " ");
  const conf = text.match(/Confirmation Number(?:\s+)?:(?:\s+)?(\w+)/i)[1];
  const lastName = text.match(
    /Entrant Name(?:\s+)?:(?:\s+)?([a-zA-Z0-9 ]+),/i,
  )[1];
  const year = text.match(/Year of Birth(?:\s+)?:(?:\s+)?(\d+)/i)[1];

  await page.type("#txtCN", conf);
  await page.type("#txtLastName", lastName);
  await page.type("#txtYOB", year);
  await page.focus("#txtCodeInput");
  await page.evaluate( () => {
    window.scrollBy(0, window.innerHeight);
  });};
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
