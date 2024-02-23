const readline = require("readline");
const axios = require("axios");
const fs = require("fs");
const { connection } = require("./jupgrid");

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function questionAsync(question) {
	return new Promise((resolve) => {
		rl.question(question, resolve);
	});
}

async function downloadTokensList() {
	const response = await axios.get("https://token.jup.ag/strict");
	const data = response.data;
	let tokens = data.map(({ symbol, address, decimals }) => ({
		symbol,
		address,
		decimals,
	}));
	fs.writeFileSync("tokens.txt", JSON.stringify(tokens));
	return data;
}

async function getTokens() {
	if (!fs.existsSync("tokens.txt")) {
		await downloadTokensList();
	}
	return JSON.parse(fs.readFileSync("tokens.txt"));
}

async function getTxFee(txhash) {
	const tx = await connection.getTransaction(txhash, "confirmed");
	return tx.meta.fee;
}

module.exports = {
	delay,
	questionAsync,
	rl,
	downloadTokensList,
	getTokens,
	getTxFee,
};
