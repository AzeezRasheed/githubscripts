const axios = require("axios");
const json2csv = require("json2csv").parse;
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const { Headers } = require('headers-polyfill');

const orgName = "SyscoCorporation";
const token = process.env.GITHUB_API_TOKEN;
dotenv.config()

const get100LicensedUser = async () => {
	try {
		const apiUrl = `https://api.github.com/orgs/${orgName}/members?filter=has_license&per_page=100&direction=desc`;
		const response = await axios.get(apiUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		let users = response.data;
		if (!users) return;
		let userRequests = [
			...users.map(async (item) => {
				const url = `https://api.github.com/user/${item.id}`;
				return await axios.get(url, {
					headers: {
						Authorization: `token ${token}`,
					},
				});
			}),
		];
		userRequests = await Promise.all(userRequests);
		users = userRequests.map((item) => item.data);
		console.log(userRequests);
		const fs = require("fs");
		const json = [
			...users.map((item) => ({
				email: item.email,
				id: item.id,
				name: item.name,
			})),
		];
		const csv = json2csv(json);
		fs.writeFile("data-licenced-users.csv", csv, (err) => {
			if (err) throw err;
			console.log("CSV file saved.");
		});
	} catch (err) {
		console.log(err);
		console.log("Request failed");
	}
};

const verifyOnboarding = (member, repo) => {
    return new Promise(async (resolve, reject) => {
        try {
            const orgName = "SyscoCorporation";
            const token = process.env.GITHUB_API_TOKEN;
            
            // Get membership
            let apiUrl = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/contributors/${member.login}`;
            let response = await axios.get(apiUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const result = response.data
            resolve(null)
        } catch (err) {
            resolve(member.id === repo.owner.id ? null : member)
        }
    })
}

const getLast100Collaborators = async () => {
	try {
		const orgName = "SyscoCorporation";
        const token = process.env.GITHUB_API_TOKEN;
        const collaborators = []
        
        // Get repos
		let apiUrl = `https://api.github.com/orgs/${orgName}/repos`;
		let response = await axios.get(apiUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
        const repos = response.data;
        // console.log(repos)


        // Get members 
        apiUrl = `https://api.github.com/orgs/${orgName}/members`;
        response = await axios.get(apiUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        let members = response.data;

        members.forEach(async (member) => {
            repos.forEach(async (repo) => {
                const result = await verifyOnboarding(member, repo);
                if (!result) collaborators.push(member)
            })
        })

        if (!collaborators.length) {
            console.log("No off boarded user found")
            return;
        }
		let userRequests = [
			...collaborators.map(async (item) => {
				const url = `https://api.github.com/user/${item.id}`;
				return await axios.get(url, {
					headers: {
						Authorization: `token ${token}`,
					},
				});
			}),
		];

		userRequests = await Promise.all(userRequests);
		users = userRequests.map((item) => item.data);

		const fs = require("fs");
		const json = [
			...users.map((item) => ({
				email: item.email,
				id: item.id,
				name: item.name,
			})),
		];
		const csv = json2csv(json);
		fs.writeFile("data-offboarded-users.csv", csv, (err) => {
			if (err) throw err;
			console.log("CSV file saved.");
		});
	} catch (err) {
		console.log("Request failed");
	}
};

const getDateOfOffboarding = (username) => {
	return new Promise((resolve) => {
		// Calculate the date 30 days ago
		const daysAgo = new Date(
			Date.now() - 30 * 24 * 60 * 60 * 1000,
		).toISOString();

		// Send a request to retrieve the audit log events
		const auditLogUrl = `${apiEndpoint}/orgs/${orgName}/audit-log?actor=${username}&after=${daysAgo}`;
		const headers = { Authorization: `Bearer ${token}` };
		axios
			.get(auditLogUrl, { headers })
			.then((response) => {
				// Filter for offboarding events
				const offboardingEvents = response.data.filter(
					(event) => event.action === "member.deleted",
				);

				if (offboardingEvents.length > 0) {
					// Print the offboarding dates
					const lastEvent = offboardingEvents[offboardingEvents.length - 1];
					resolve(lastEvent.created_at);
				} else {
					reject();
				}
			})
			.catch((error) => {
				reject();
				console.error("Error retrieving audit log events.", error);
			});
	});
};

async function getLast100OffBoardedUsers() {
	let users = [];
	try {
		const url = `https://api.github.com/orgs/${orgName}/audit-log?phrase=offboarded%20user&per_page=100&page=1`;
		// const headers = { Authorization: `Bearer ${token}` };
		const headers = new Headers({
			Authorization: `Bearer ${token}`,
		});
		let response = await fetch(url, { headers });
		let events = await response.json();

		while (users.length < 1000 && response.ok) {
			for (let event of events) {
				if (
					event.target.type === "User" &&
					(event.action === "user.suspend" || event.action === "user.delete")
				) {
					users.push(event.target.login);
					if (users.length === 1000) {
						break;
					}
				}
			}

			if (users.length === 1000) {
				break;
			}

			if (response.headers.has("Link")) {
				let linkHeader = response.headers.get("Link");
				let nextPageUrl = linkHeader
					.split(",")
					.find((link) => link.includes('rel="next"'));
				if (nextPageUrl) {
					nextPageUrl = nextPageUrl.split(";")[0].slice(1, -1);
					response = await fetch(nextPageUrl, { headers });
					events = await response.json();
				} else {
					break;
				}
			} else {
				break;
			}
		}

		if (!users.length) {
			console.log("Offboarded user not found");
			return;
		}
		let timestamps = users.map((user) => getDateOfOffboarding(user.login));
		timestamps = await Promise.all(timestamps);
		const json = [
			...members.map((item, index) => ({
				email: item.email,
				id: item.id,
				name: item.name,
				timestamp: timestamps[index],
			})),
		];
		const csv = json2csv(json);
		fs.writeFile("data-offboarded-users.csv", csv, (err) => {
			if (err) throw err;
			console.log("CSV file saved.");
		});
	} catch (error) {
		console.error(error);
	}
}

const members = []
const deleteLastContibutionIn30Days = async () => {
	const date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);

	// Get the list of members
	let members_url = `https://api.github.com/orgs/${orgName}/members`;
	fetch(members_url, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	})
		.then((res) => resizeBy.json())
		.then((returnedMembers) => {
			members = returnedMembers;
			const contributions_url = `https://api.github.com/search/commits?q=org:${orgName}+committer-date:>${date}&sort=committer-date&order=desc`;
			return fetch(contributions_url);
		})
		.then((response) => response.json())
		.then((data) => {
			const contributors = new Set(data.items.map((item) => item.author.login));
			const inactive_members = members.for(
				(member) => !contributors.has(member.login),
			);
			console.log(
				`The following members have not contributed to ${orgName} in the last 30 days:`,
				inactive_members,
			);

			// Delete inactive members
			inactive_members.forEach((member) => {
				const delete_url = `https://api.github.com/orgs/${orgName}/members/${member.login}`;
				fetch(delete_url, {
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${access_token}`,
					},
				})
					.then((response) => {
						if (response.ok) {
							console.log(`Removed ${member.login} from ${orgName}.`);
						} else {
							console.error(`Error removing ${member.login} from ${orgName}.`);
						}
					})
					.catch((error) => console.error(error));
			});
		})
		.catch((error) => console.error(error));
};

get100LicensedUser();

getLast100OffBoardedUsers();

// deleteLastContibutionIn30Days();