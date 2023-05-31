import dotenv from "dotenv";
import fetch from "node-fetch";
import express from "express";
import readline from "readline";
import cron from "node-cron";
import fs from "fs";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import nodemailer from "nodemailer";

dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on port: ${port}..`));

const send_to = process.env.EMAIL_ORGANIZATION; // this is the organisation email that we want to send the users to
const sent_from = process.env.EMAIL_USER; // this is the organisation email that we want to send the users to
const reply_to = process.env.EMAIL_USER; // this is the email address that in charge of deleting the users

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const orgName = process.env.ORG_NAME;
const token = process.env.GITHUB_API_TOKEN;
const inactiveUsers_filename = "inactive-users.csv";
const deletedUsers_filename = "deleted-users.csv";

const sendEmail = async (subject, message, send_to, sent_from, reply_to) => {
  // Create Email Transporter
  const transporter = nodemailer.createTransport({
    host: "smpt.gmail.com",
    secure: false, // Set it to true if you want to use TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Option for sending email
  const options = {
    from: sent_from,
    to: send_to,
    replyTo: reply_to,
    subject: subject,
    html: message,
  };

  // send email
  transporter.sendMail(options, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      //   console.log(info);
    }
  });
};

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

async function inactiveUsersIn30Days() {
  let allUsers = [];

  let page = 1;
  let hasNextPage = true;
  try {
    // Get the list of users
    const users_url = `https://api.github.com/orgs/${orgName}/members`;
    while (hasNextPage) {
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
        console.error("Error retrieving users:", response.status);
        break;
      }
    }
    // console.log(users, "------");
    console.log("Total users:", allUsers.length);

    const csvData = allUsers
      .map((user) => `${user.id},${user.login},${user.url}`)
      .join("\n");

    fs.writeFile("usersList.csv", csvData, (err) => {
      if (err) {
        console.error("Error writing to CSV file:", err);
      } else {
        console.log("Data written to CSV file successfully.");
      }
    });
    //   Get the last login time of each users
    const usersWithLastLogin = await Promise.all(
      allUsers.map(async (users) => {
        const userResponse = await fetch(users.url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const userData = await userResponse.json();
        return {
          login: users.login,
          id: users.id,
          url: users.url,
          lastLogin: userData.updated_at,
        };
      })
    );

    const inactiveUsers = getInactiveUsers(usersWithLastLogin);

    // Create the email message
    const subject = "Inactive Users Report";
    const message = `
	<html>
	  <head>
		<style>
		  table {
			border-collapse: collapse;
			width: 100%;
		  }
  
		  th, td {
			padding: 8px;
			text-align: left;
			border-bottom: 1px solid #ddd;
		  }
  
		  th {
			background-color: #f2f2f2;
		  }
		</style>
	  </head>
	  <body>
		<h2>Here are the users who have not logged in to ${orgName} in the last 30 days:</h2>
		<table>
		  <tr>
			<th>Login</th>
			<th>ID</th>
			<th>URL</th>
			<th>Last Login</th>
		  </tr>
		  ${inactiveUsers
        .map(
          (user) => `
				<tr>
				  <td>${user.login}</td>
				  <td>${user.id}</td>
				  <td>${user.url}</td>
				  <td>${user.lastLogin}</td>
				</tr>
			  `
        )
        .join("")}
		</table>
	  </body>
	</html>
  `;

    try {
      await sendEmail(subject, message, send_to, sent_from, reply_to);
      console.log(`Report sent to ${process.env.EMAIL_ORGANIZATION}`);
    } catch (error) {
      console.log("Email not sent, please try again");
    }

    console.log(
      `${inactiveUsers.length} users have not logged in to ${orgName} in the last 30 days`
    );

    // write inactiveUsers users to a CSV file
    const header = [
      { id: "login", title: "login" },
      { id: "id", title: "id" },
      { id: "url", title: "url" },
      { id: "lastLogin", title: "lastLogin" },
    ];
    await writeCsvFile(inactiveUsers_filename, header, inactiveUsers);

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
          inactiveUsers.forEach((user) => {
            deleteInactiveUser(user.login);
            deletedUsers.push(user);
          });

          // write deleted users users to a CSV file
          const header = [
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
