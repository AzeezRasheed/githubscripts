import dotenv from "dotenv";
import fetch from "node-fetch";
import express from "express";
import readline from "readline";
import cron from "node-cron";
import fs from "fs";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import axios, { all } from "axios";
import nodemailer from "nodemailer";

dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port: ${port}..`));

const send_to = process.env.EMAIL_ORGANIZATION;
const sent_from = process.env.EMAIL_USER;
const reply_to = process.env.EMAIL_USER;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const orgName = process.env.ORG_NAME;
const token = process.env.GITHUB_API_TOKEN;
const inactiveUsers_filename = "inactive-users.csv";
const deletedUsers_filename = "deleted-users.csv";

function checkIfLoggedIn30DaysAgo(givenDate) {
  // Convert the given date string to a Date object
  const givenDateObj = new Date(givenDate);

  // Get the current date
  const currentDate = new Date();

  // Calculate the date 30 days ago
  const thirtyDaysAgo = new Date(
    currentDate.getTime() - 30 * 24 * 60 * 60 * 1000
  );

  // Check if the given date is within the last 30 days
  if (givenDateObj >= thirtyDaysAgo && givenDateObj <= currentDate) {
    return true;
  } else {
    return false;
  }
}

function getInactiveUsers(users, days = 30) {
  const filteredUsers = users.filter((users) => {
    const usersLastLoginDate = Date.parse(users.lastLogin);
    const maxDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();
    const filterDate = Date.parse(maxDate);
    return usersLastLoginDate < filterDate;
  });

  return filteredUsers;
}

async function deleteInactiveUser(user) {
  // console.log(`User ${user} deleted (not really...)`)

  try {
    const response = await fetch(
      `https://api.github.com/orgs/${orgName}/members/${user}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.status === 204) {
      console.log(`User ${user} has been deleted successfully!`);
    } else {
      console.log(
        `Failed to delete user ${user}. Response status: ${response.status}`
      );
    }
  } catch (error) {
    console.error(`Failed to delete user ${user}. Error: ${error}`);
  }
}

async function writeCsvFile(path, header, data) {
  const csvWriter = createObjectCsvWriter({
    path,
    header,
  });

  try {
    await csvWriter.writeRecords(data);
    console.log("Data written to CSV file successfully");
  } catch (error) {
    console.error(error);
  }
}

async function fetchProcessedUsersTest() {
  try {
    const data = await new Promise((resolve, reject) => {
      fs.readFile("usersList.json", "utf8", (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });

    const allUsers = JSON.parse(data);
    return allUsers;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function fetchAllUsers() {
  let allUsers = [];
  let page = 1;
  let hasNextPage = true;
  // Get the list of users
  const users_url = `https://api.github.com/orgs/${orgName}/members`;
  while (hasNextPage) {
    console.log(`processing batch ${page} of all users`);

    const url = `${users_url}?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const users = await response.json();
      allUsers = allUsers.concat(users);

      const linkHeader = response.headers.get("Link");
      hasNextPage = linkHeader && linkHeader.includes('rel="next"');
      page++;
    } else {
      console.error("Error retrieving user:", response.status);
      console.log(response);
      break;
    }
  }

  console.log("Total users:", allUsers.length);
  return allUsers;
}

async function inactiveUsersIn30Days() {
  try {
    // let allUsers = await fetchAllUsers();

    // const csvData = allUsers
    // 	.map((user) => `${user.id},${user.login},${user.url}`)
    // 	.join("\n");

    // fs.writeFile("usersList.csv", csvData, (err) => {
    // 	if (err) {
    // 		console.error("Error writing to CSV file:", err);
    // 	} else {
    // 		console.log("Data written to CSV file successfully.");
    // 	}
    // });

    // // Get the last login time of each users
    // console.log(`Fetching users details...`)
    // const usersWithLastLogin = await Promise.all(
    // 	allUsers.slice(0, 220).map(async (user) => {
    // 		const userResponse = await fetch(user.url, {
    // 			headers: {
    // 				Authorization: `Bearer ${token}`,
    // 			},
    // 		});
    // 		const userData = await userResponse.json();
    // 		console.log(user.id)
    // 		return {
    // 			login: user.login,
    // 			id: user.id,
    // 			url: user.url,
    // 			lastLogin: userData.updated_at,
    // 		};
    // 	})
    // )

    // console.log("usersWithLastLogin", usersWithLastLogin.length)
    // fs.writeFile("usersList.json", JSON.stringify(usersWithLastLogin), (err) => {
    // 	if (err) {
    // 		console.error("Error writing usersList to CSV file:", err);
    // 	} else {
    // 		console.log("usersList written to CSV file successfully.");
    // 	}
    // });

    // Example usage to check if a user have logged in within the last 30 days:
    const givenDate = "2022-06-09T15:39:10Z";
    const isLoggedIn30DaysAgo = checkIfLoggedIn30DaysAgo(givenDate);

    console.log(
      `The user ${
        isLoggedIn30DaysAgo ? "logged in" : "did not log in"
      } 30 days ago`
    );

    console.log(`Processing inactive users..`);

    const usersWithLastLogin = await fetchProcessedUsersTest();

    let inactiveUsers = getInactiveUsers(usersWithLastLogin);
    console.log(
      `${inactiveUsers.length} users have not logged in to ${orgName} in the last 30 days`
    );

    // number users
    inactiveUsers = inactiveUsers.map((user, i) => {
      return {
        "s/n": i + 1,
        login: user.login,
        id: user.id,
        url: user.url,
        lastLogin: user.lastLogin,
      };
    });

    // write inactiveUsers users to a CSV file
    const header = [
      { id: "s/n", title: "s/n" },
      { id: "login", title: "login" },
      { id: "id", title: "id" },
      { id: "url", title: "url" },
      { id: "lastLogin", title: "lastLogin" },
    ];

    await writeCsvFile(inactiveUsers_filename, header, inactiveUsers);

    // Set the batch size
    const batchSize = 100;

    // Calculate the number of iterations required
    const iterations = Math.ceil(inactiveUsers.length / batchSize);

    // Process sending the inactiveUsers to the teams channel in batches
    for (let i = 0; i < iterations; i++) {
      // Calculate the start and end index for the current batch
      const start = i * batchSize;
      const end = start + batchSize;

      // Get the current batch of inactiveUsers using array slicing
      const currentBatch = inactiveUsers.slice(start, end);
      // Create the email message
      // const subject = `${inactiveUsers.length} Users have not logged in to ${orgName} github account in the last 30 days`;
      const date = new Date();

      let day = date.getDate();
      let month = date.getMonth() + 1;
      let year = date.getFullYear();

      // This arrangement can be altered based on how we want the date's format to appear.
      let currentDate = `${day}-${month}-${year}`;

      const message = `<html><head><style>table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:left;border-bottom:1px solid #ddd}th{background-color:#f2f2f2}</style></head><body><h1>Report for <code>${currentDate}</code></h1><h2>${
        inactiveUsers.length
      } Users have not logged in to ${orgName} github account in the last 30 days</h2><h3>Here are the list of users ${
        start + 1
      } - ${end}</h3><br/><br/><table><tr><th>s/n</th><th>Login</th><th>ID</th><th>URL</th><th>Last Login</th></tr>${currentBatch
        .map(
          (user) =>
            `<tr><td>${user["s/n"]}</td><td>${user.login}</td><td>${user.id}</td><td>${user.url}</td><td>${user.lastLogin}</td></tr>`
        )
        .join("")}</table></body></html>`;

      const webhookUrl =
        "https://sysco.webhook.office.com/webhookb2/955026a7-0e71-4bbd-8bd1-fa20c236add1@b7aa4308-bf33-414f-9971-6e0c972cbe5d/IncomingWebhook/bec292168bb1416693f8b99cbdc3dd23/9e05cd3f-c133-4abc-a905-5368feb8deae";
      const messagePayload = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "0072C6",
        summary: "Inactive Users Report",
        sections: [
          {
            activityTitle: "Inactive Users Report",
            activitySubtitle: "Posted via webhook",
            activityImage: "https://example.com/images/avatar.png",
            text: message,
            contenType: "html",
          },
        ],
      };

      axios
        .post(webhookUrl, messagePayload)
        .then((response) => {
          console.log("Webhook message sent:", response.data);
        })
        .catch((error) => {
          console.error("Error sending webhook message:", error);
        });
    }

    // delete inactive users with prompt
    // The user is able to review and edit the generated csv for users marked for deletion at inactiveUsers_filename
    // send prompt
    const answer = await new Promise((resolve) => {
      rl.question(
        "Do you want to delete users in inactive-users.csv? (you can edit the list before providing an answer) (y/n): ",
        (answer) => {
          resolve(answer);
          rl.close();
        }
      );
    });

    if (answer.toLowerCase() === "y") {
      console.log("User chose to continue.");

      // read current list from csŠ
      const inactiveUsers = [];
      const deletedUsers = [];
      fs.createReadStream(inactiveUsers_filename)
        .pipe(csv())
        .on("data", (data) => {
          // Extract the value of the first column (index 0xzasS)
          // const firstColumnValue = data[Object.keys(data)[0]];
          inactiveUsers.push(data);
        })
        .on("end", () => {
          console.log(`InactiveUsers to be deleted ${inactiveUsers}`);
          // inactiveUsers.forEach((user) => {
          // 	deleteInactiveUser(user.login);
          // 	deletedUsers.push(user);
          // });

          // write deleted users users to a CSV file
          const header = [
            { id: "s/n", title: "S/N" },
            { id: "login", title: "Login" },
            { id: "id", title: "ID" },
            { id: "url", title: "URL" },
            { id: "lastLogin", title: "Last Login" },
          ];
          writeCsvFile(deletedUsers_filename, header, deletedUsers);
        });
    } else {
      console.log("User chose to cancel.");
      process.exit(1);
    }
  } catch (error) {
    console.error(error);
  }
}

inactiveUsersIn30Days();
