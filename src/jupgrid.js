// #region imports
import axios from 'axios';
import bs58 from 'bs58';
import chalk from 'chalk';
import fetch from 'cross-fetch';
import * as fs from 'fs';
import ora from 'ora';

import {
	LimitOrderProvider,
	ownerFilter
} from '@jup-ag/limit-order-sdk';
import { program } from '@project-serum/anchor/dist/cjs/native/system.js';
import * as solanaWeb3 from '@solana/web3.js';
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction
} from '@solana/web3.js';

import {
	envload,
	loaduserSettings,
	saveuserSettings
} from './settings.js';
import {
	delay,
	downloadTokensList,
	getTokenAccounts,
	getTokens,
	questionAsync,
	rl
} from './utils.js';

// #endregion

// #region constants
// use fs to to read version from package.json
const packageInfo = JSON.parse(fs.readFileSync("package.json", "utf8"));

const version = packageInfo.version;

const [MIN_WAIT, MAX_WAIT] = [5e2, 5e3];

const [payer, rpcUrl] = envload();

const connection = new Connection(rpcUrl, "processed", {
	confirmTransactionInitialTimeout: 5000
});
const limitOrder = new LimitOrderProvider(connection);

let shutDown = false;

const walletAddress = payer.publicKey.toString();
const displayAddress = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;

const quoteurl = "https://quote-api.jup.ag/v6/quote";
const JitoBlockEngine = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

const TIP_ACCOUNTS = [
	"96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
	"HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
	"Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
	"ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
	"DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
	"ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
	"DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
	"3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
];

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";

const getRandomTipAccount = () =>
	TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];
// #endregion

// #region properties
let {
	validTokenA = null,
	validTokenB = null,
	selectedTokenA = null,
	selectedTokenB = null,
	selectedAddressA = null,
	selectedAddressB = null,
	selectedDecimalsA = null,
	selectedDecimalsB = null,
	tradeSizeInLamports = null,
	validSpread = null,
	stopLossUSD = null,
	infinityTarget = null,
	loaded = false,
	openOrders = [],
	checkArray = [],
	tokens = [],
	newPrice = null,
	startPrice = null,
	spread = null,
	spreadbps = null,
	initBalanceA = 0,
	initUsdBalanceA = 0,
	initBalanceB = 0,
	initUsdBalanceB = 0,
	currBalanceA = 0,
	currBalanceB = 0,
	currUSDBalanceA = 0,
	currUSDBalanceB = 0,
	initUsdTotalBalance = 0,
	currUsdTotalBalance = 0,
	tokenRebalanceValue = null,
	tokenARebalanceValue = 0,
	tokenBRebalanceValue = 0,
	startTime = new Date(),
	monitorDelay = null,
	adjustmentA = 0,
	adjustmentB = 0,
	stopLoss = false,
	jitoRetry = 0,
	infinityBuyInputLamports,
	infinityBuyOutputLamports,
	infinitySellInputLamports,
	infinitySellOutputLamports,
	counter = 0,
	lastTip = null,
	askForRebalance = true,
	newPriceBUp = null,
	newPriceBDown = null,
	userSettings = {
		selectedTokenA: null,
		selectedTokenB: null,
		tradeSize: null,
		spread: null,
		rebalanceAllowed: null,
		rebalancePercentage: null,
		rebalanceSlippageBPS: null,
		monitorDelay: null,
		stopLossUSD: null,
		infinityTarget: null,
		infinityMode: null
	}
} = {};
// #endregion

async function loadQuestion() {
	try {
		await downloadTokensList();
		console.log("Updated Token List\n");
		console.log(`Connected Wallet: ${displayAddress}\n`);

		if (!fs.existsSync("userSettings.json")) {
			console.log("No user data found. Starting with fresh inputs.");
			initialize();
		} else {
			const askForLoadSettings = () => {
				rl.question(
					"Do you wish to load your saved settings? (Y/N): ",
					function (responseQ) {
						responseQ = responseQ.toUpperCase(); // Case insensitivity

						if (responseQ === "Y") {
							try {
								// Show user data
								const userSettings = loaduserSettings();
								console.log("User data loaded successfully.");
								console.log(
									`\nPrevious JupGrid Settings:
Token A: ${chalk.cyan(userSettings.selectedTokenA)}
Token B: ${chalk.magenta(userSettings.selectedTokenB)}
Infinity Target: ${userSettings.infinityTarget}
Spread: ${userSettings.spread}%
Stop Loss: ${userSettings.stopLossUSD}
Monitoring delay: ${userSettings.monitorDelay}ms\n`
								);
								// Prompt for confirmation to use these settings
								rl.question(
									"Proceed with these settings? (Y/N): ",
									function (confirmResponse) {
										confirmResponse =
											confirmResponse.toUpperCase();
										if (confirmResponse === "Y") {
											// Apply loaded settings
											({
												selectedTokenA,
												selectedAddressA,
												selectedDecimalsA,
												selectedTokenB,
												selectedAddressB,
												selectedDecimalsB,
												spread,
												monitorDelay,
												stopLossUSD,
												infinityTarget
											} = userSettings);
											console.log(
												"Settings applied successfully!"
											);
											initialize();
										} else if (confirmResponse === "N") {
											console.log(
												"Discarding saved settings, please continue."
											);
											initialize(); // Start initialization with blank settings
										} else {
											console.log(
												"Invalid response. Please type 'Y' or 'N'."
											);
											askForLoadSettings(); // Re-ask the original question
										}
									}
								);
							} catch (error) {
								console.error(
									`Failed to load settings: ${error}`
								);
								initialize(); // Proceed with initialization in case of error
							}
						} else if (responseQ === "N") {
							console.log("Starting with blank settings.");
							initialize();
						} else {
							console.log(
								"Invalid response. Please type 'Y' or 'N'."
							);
							askForLoadSettings(); // Re-ask if the response is not Y/N
						}
					}
				);
			};

			askForLoadSettings(); // Start the question loop
		}
	} catch (error) {
		console.error("Error:", error);
	}
}

async function initialize() {
	if (selectedTokenA != null) {
		validTokenA = true;
	}
	if (selectedTokenB != null) {
		validTokenB = true;
	}
	if (spread != null) {
		validSpread = true;
	}
	let validMonitorDelay = false;
	if (monitorDelay >= 5000) {
		validMonitorDelay = true;
	}
	let validStopLossUSD = false;
	if (stopLossUSD != null) {
		validStopLossUSD = true;
	}
	let validInfinityTarget = false;
	if (infinityTarget != null) {
		validInfinityTarget = true;
	}

	tokens = await getTokens();

	if (userSettings.selectedTokenA) {
  	const tokenAExists = tokens.some(
    (token) => token.symbol === userSettings.selectedTokenA
  	);
  	if (!tokenAExists) {
    console.log(
      `Token ${userSettings.selectedTokenA} from user data not found in the updated token list. Please re-enter.`
    );
    userSettings.selectedTokenA = null; // Reset selected token A
    userSettings.selectedAddressA = null; // Reset selected address
    userSettings.selectedDecimalsA = null; // Reset selected token decimals
  } else {
    validTokenA = true;
  }
}

while (!validTokenA) {
	console.log("During this Beta stage, we are only allowing USDC as Token A. Is that ok?");
	// Simulate the user entered 'USDC' as their answer
	const answer = 'USDC';

  const token = tokens.find((t) => t.symbol === answer);
  if (token) {
    console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
    const confirmAnswer = await questionAsync(
      `Is this the correct token? (Y/N): `
    );
    if (
      confirmAnswer.toLowerCase() === "y" ||
      confirmAnswer.toLowerCase() === "yes"
    ) {
      validTokenA = true;
      selectedTokenA = token.symbol;
      selectedAddressA = token.address;
      selectedDecimalsA = token.decimals;
    }
  } else {
    console.log(`Token ${answer} not found. Please Try Again.`);
  }
}

	if (userSettings.selectedTokenB) {
		const tokenBExists = tokens.some(
			(token) => token.symbol === userSettings.selectedTokenB
		);
		if (!tokenBExists) {
			console.log(
				`Token ${userSettings.selectedTokenB} from user data not found in the updated token list. Please re-enter.`
			);
			userSettings.selectedTokenB = null; // Reset selected token B
			userSettings.selectedAddressB = null; // Reset selected address
			userSettings.selectedDecimalsB = null; // Reset selected token decimals
		} else {
			validTokenB = true;
		}
	}

	while (!validTokenB) {
		const answer = await questionAsync(
			`Please Enter The Second Token Symbol (B) (Case Sensitive): `
		);
		const token = tokens.find((t) => t.symbol === answer);
		if (token) {
			console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
			const confirmAnswer = await questionAsync(
				`Is this the correct token? (Y/N): `
			);
			if (
				confirmAnswer.toLowerCase() === "y" ||
				confirmAnswer.toLowerCase() === "yes"
			) {
				validTokenB = true;
				selectedTokenB = token.symbol;
				selectedAddressB = token.address;
				selectedDecimalsB = token.decimals;
			}
		} else {
			console.log(`Token ${answer} not found. Please Try Again.`);
		}
	}

	// If infinity target value is not valid, prompt the user
	while (!validInfinityTarget) {
		const infinityTargetInput = await questionAsync(
			`Please Enter the Infinity Target Value: `
		);
		infinityTarget = Math.floor(parseFloat(infinityTargetInput));
		if (
			!isNaN(infinityTarget) &&
			Number.isInteger(infinityTarget) &&
			infinityTarget > userSettings.stopLossUSD
		) {
			userSettings.infinityTarget = infinityTarget;
			validInfinityTarget = true;
		} else {
			console.log(
				"Invalid infinity target value. Please enter a valid integer that is larger than the stop loss value."
			);
		}
	}

	// Ask user for spread %
	// Check if spread percentage is valid
	if (userSettings.spread) {
		validSpread = !isNaN(parseFloat(userSettings.spread));
		if (!validSpread) {
			console.log(
				"Invalid spread percentage found in user data. Please re-enter."
			);
			userSettings.spread = null; // Reset spread percentage
		} else validSpread = true;
	}

	// If spread percentage is not valid, prompt the user
	while (!validSpread) {
		const spreadInput = await questionAsync(
			"What % Spread Difference Between Market and Orders? Recommend >0.3% to cover Jupiter Fees, but 1% or greater for best performance:"
		);
		spread = parseFloat(spreadInput);
		if (!isNaN(spread)) {
			userSettings.spread = spread;
			validSpread = true;
		} else {
			console.log(
				"Invalid spread percentage. Please enter a valid number (No % Symbol)."
			);
		}
	}

	if (userSettings.stopLossUSD) {
		validStopLossUSD = !isNaN(parseFloat(userSettings.stopLossUSD));
		if (!validStopLossUSD) {
			console.log(
				"Invalid stop loss value found in user data. Please re-enter."
			);
			userSettings.stopLossUSD = null; // Reset stop loss value
		} else validStopLossUSD = true;
	}

	// If stop loss value is not valid, prompt the user
	while (!validStopLossUSD) {
		const stopLossUSDInput = await questionAsync(
			`Please Enter the Stop Loss Value in USD: (Enter 0 for no stoploss) `
		);
		stopLossUSD = parseFloat(stopLossUSDInput);
		if (!isNaN(stopLossUSD)) {
			userSettings.stopLossUSD = stopLossUSD;
			validStopLossUSD = true;
		} else {
			console.log(
				"Invalid stop loss value. Please enter a valid number."
			);
		}
	}

	while (!validMonitorDelay) {
		const monitorDelayQuestion = await questionAsync(
			`Enter the delay between price checks in milliseconds (minimum 5000ms): `
		);
		const parsedMonitorDelay = parseInt(monitorDelayQuestion.trim());
		if (!isNaN(parsedMonitorDelay) && parsedMonitorDelay >= 5000) {
			monitorDelay = parsedMonitorDelay;
			validMonitorDelay = true;
		} else {
			console.log(
				"Invalid monitor delay. Please enter a valid number greater than or equal to 5000."
			);
		}
	}

	spreadbps = spread * 100;
	//rl.close(); // Close the readline interface after question loops are done.

	saveuserSettings(
		selectedTokenA,
		selectedAddressA,
		selectedDecimalsA,
		selectedTokenB,
		selectedAddressB,
		selectedDecimalsB,
		spread,
		monitorDelay,
		stopLossUSD,
		infinityTarget
	);
	// First Price check during init
	console.log("Getting Latest Price Data...");
	tradeSizeInLamports = 1 * Math.pow(10, selectedDecimalsB);
	const queryParams = {
		inputMint: selectedAddressB,
		outputMint: selectedAddressA,
		amount: tradeSizeInLamports,
		slippageBps: 0
	};
	const response = await axios.get(quoteurl, { params: queryParams });

	newPrice = response.data.outAmount;
	startPrice = response.data.outAmount;

	console.clear();
	console.log(`Starting JupGrid v${version}
Your Token Selection for A - Symbol: ${chalk.cyan(selectedTokenA)}, Address: ${chalk.cyan(selectedAddressA)}
Your Token Selection for B - Symbol: ${chalk.magenta(selectedTokenB)}, Address: ${chalk.magenta(selectedAddressB)}`);
	startInfinity();
}

if (loaded === false) {
	loadQuestion();
}

async function startInfinity() {
	console.log(`Checking for existing orders to cancel...`);
	await jitoController("cancel");
	const initialBalances = await getBalance(
		payer,
		selectedAddressA,
		selectedAddressB,
		selectedTokenA,
		selectedTokenB
	);
	initBalanceA = initialBalances.balanceA;
	initUsdBalanceA = initialBalances.usdBalanceA;
	initBalanceB = initialBalances.balanceB;
	initUsdBalanceB = initialBalances.usdBalanceB;
	initUsdTotalBalance = initUsdBalanceA + initUsdBalanceB;
	infinityGrid();
}

async function getBalance(
	payer,
	selectedAddressA,
	selectedAddressB,
	selectedTokenA,
	selectedTokenB
) {
	async function getSOLBalanceAndUSDC() {
		const lamports = await connection.getBalance(payer.publicKey);
		const solBalance = lamports / solanaWeb3.LAMPORTS_PER_SOL;
		if (solBalance === 0) {
			console.log(`You do not have any SOL, please check and try again.`);
			process.exit(0);
		}
		let usdBalance = 0;
		if (selectedTokenA === "SOL" || selectedTokenB === "SOL") {
			try {
				const queryParams = {
					inputMint: SOL_MINT_ADDRESS,
					outputMint: USDC_MINT_ADDRESS,
					amount: lamports, // Amount in lamports
					slippageBps: 0
				};
				const response = await axios.get(quoteurl, {
					params: queryParams
				});
				usdBalance = response.data.outAmount / Math.pow(10, 6) || 0;
				tokenRebalanceValue =
					response.data.outAmount / (lamports / Math.pow(10, 3));
			} catch (error) {
				console.error("Error fetching USDC equivalent for SOL:", error);
			}
		}
		return { balance: solBalance, usdBalance, tokenRebalanceValue };
	}

	async function getTokenAndUSDCBalance(mintAddress, decimals) {
		if (
			!mintAddress ||
			mintAddress === "So11111111111111111111111111111111111111112"
		) {
			return getSOLBalanceAndUSDC();
		}

		const tokenAccounts = await getTokenAccounts(
			connection,
			payer.publicKey,
			mintAddress
		);
		if (tokenAccounts.value.length > 0) {
			const balance =
				tokenAccounts.value[0].account.data.parsed.info.tokenAmount
					.uiAmount;
			let usdBalance = 0;
			if (balance === 0) {
				console.log(
					`You do not have a balance for ${mintAddress}, please check and try again.`
				);
				process.exit(0);
			}
			if (mintAddress !== USDC_MINT_ADDRESS) {
				const queryParams = {
					inputMint: mintAddress,
					outputMint: USDC_MINT_ADDRESS,
					amount: Math.floor(balance * Math.pow(10, decimals)),
					slippageBps: 0
				};

				try {
					const response = await axios.get(quoteurl, {
						params: queryParams
					});
					// Save USD Balance and adjust down for Lamports
					usdBalance = response.data.outAmount / Math.pow(10, 6);
					tokenRebalanceValue =
						response.data.outAmount / (balance * Math.pow(10, 6));
				} catch (error) {
					console.error("Error fetching USDC equivalent:", error);
					usdBalance = 1;
				}
			} else {
				usdBalance = balance; // If the token is USDC, its balance is its USD equivalent
				if (usdBalance === 0) {
					console.log(
						`You do not have any USDC, please check and try again.`
					);
					process.exit(0);
				}
				tokenRebalanceValue = 1;
			}

			return { balance, usdBalance, tokenRebalanceValue };
		} else {
			return { balance: 0, usdBalance: 0, tokenRebalanceValue: null };
		}
	}

	const resultA = await getTokenAndUSDCBalance(
		selectedAddressA,
		selectedDecimalsA
	);
	const resultB = await getTokenAndUSDCBalance(
		selectedAddressB,
		selectedDecimalsB
	);

	if (resultA.balance === 0 || resultB.balance === 0) {
		console.log(
			"Please ensure you have a balance in both tokens to continue."
		);
		process.exit(0);
	}

	return {
		balanceA: resultA.balance,
		usdBalanceA: resultA.usdBalance,
		tokenARebalanceValue: resultA.tokenRebalanceValue,
		balanceB: resultB.balance,
		usdBalanceB: resultB.usdBalance,
		tokenBRebalanceValue: resultB.tokenRebalanceValue
	};
}

function formatElapsedTime(startTime) {
	const currentTime = new Date();
	const elapsedTime = currentTime - startTime; // Difference in milliseconds

	let totalSeconds = Math.floor(elapsedTime / 1000);
	let hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600;
	let minutes = Math.floor(totalSeconds / 60);
	let seconds = totalSeconds % 60;

	// Padding with '0' if necessary
	hours = String(hours).padStart(2, "0");
	minutes = String(minutes).padStart(2, "0");
	seconds = String(seconds).padStart(2, "0");

	console.log(`\u{23F1}  Run time: ${hours}:${minutes}:${seconds}`);
}

async function fetchPrice() {
    const response = await axios.get('https://price.jup.ag/v6/price?ids=SOL');
    const price = response.data.data.SOL.price;
    return parseFloat(price.toFixed(2));
}

async function infinityGrid() {
	if (shutDown) return;
	counter++;
	await jitoController("cancel");
	await jitoController("rebalance");
	askForRebalance = false;
	const currentBalances = await getBalance(
		payer,
		selectedAddressA,
		selectedAddressB,
		selectedTokenA,
		selectedTokenB
	);
	tradeSizeInLamports = 1 * Math.pow(10, selectedDecimalsB);
	const queryParams = {
		inputMint: selectedAddressB,
		outputMint: selectedAddressA,
		amount: tradeSizeInLamports,
		slippageBps: 0
	};
	const response = await axios.get(quoteurl, { params: queryParams });
	const priceResponse =
		response.data.outAmount / Math.pow(10, selectedDecimalsA);

	currBalanceA = currentBalances.balanceA; // Current balance of token A
	currBalanceB = currentBalances.balanceB; // Current balance of token B
	currUSDBalanceA = currentBalances.usdBalanceA; // Current USD balance of token A
	currUSDBalanceB = currentBalances.usdBalanceB; // Current USD balance of token B
	currUsdTotalBalance = currentBalances.usdBalanceA + currentBalances.usdBalanceB; // Current total USD balance

	if (currUsdTotalBalance < stopLossUSD) {
		// Emergency Stop Loss
		console.clear();
		console.log(`\n\u{1F6A8} Emergency Stop Loss Triggered! - Exiting`);
		stopLoss = true;
		process.kill(process.pid, "SIGINT");
	}
	// Calculate the new prices of tokenB when it's up 1% and down 1%
	newPriceBUp = priceResponse * (1 + spreadbps / 10000);
	newPriceBDown = priceResponse * (1 - spreadbps / 10000);
	const ratio = newPriceBUp / newPriceBDown;

	// Calculate the amount of tokenB to sell to maintain the target USD value
	let infinitySellInput = Math.abs(
		(infinityTarget - currentBalances.balanceB * newPriceBUp) / newPriceBUp
	); // USD Output, then Div by price to get lamports
	let infinitySellOutput = Math.abs(infinitySellInput * newPriceBUp); // Lamports * Price to get USD Input
	infinitySellInput *= ratio; // Adjust for the ratio
	infinitySellOutput *= ratio; // Adjust for the ratio
	
	// Convert to lamports
	infinitySellInputLamports = Math.floor(
		infinitySellInput * Math.pow(10, selectedDecimalsB)
	);
	infinitySellOutputLamports = Math.floor(
		infinitySellOutput * Math.pow(10, selectedDecimalsA)
	);

	console.log(`Current Market Price: ${priceResponse.toFixed(5)}
	Infinity Target: ${infinityTarget}
	Current ${selectedTokenB} Balance: ${currentBalances.balanceB} (${currentBalances.usdBalanceB.toFixed(2)})

	${selectedTokenB} up ${spread}%: ${newPriceBUp.toFixed(5)}
	Amount of ${selectedTokenB} to send: ${infinitySellInput.toFixed(5)} (${infinitySellInputLamports} lamports)
	Amount of ${selectedTokenA} to receive: ${infinitySellOutput.toFixed(5)} (${infinitySellOutputLamports} lamports)`);

	// Calculate the amount of tokenB to buy to maintain the target USD value
	let infinityBuyOutput = Math.abs(
		(infinityTarget - currentBalances.balanceB * newPriceBDown) / newPriceBDown
	); // USD Output, then Div by price to get lamports
	let infinityBuyInput = Math.abs(infinityBuyOutput * newPriceBDown); // Lamports * Price to get USD Input
	infinityBuyOutput /= ratio; // Adjust for the ratio
	infinityBuyInput /= ratio; // Adjust for the ratio

	// Convert to lamports and floor the values
	infinityBuyOutputLamports = Math.floor(
		infinityBuyOutput * Math.pow(10, selectedDecimalsB)
	);
	infinityBuyInputLamports = Math.floor(
		infinityBuyInput * Math.pow(10, selectedDecimalsA)
	);

	console.log(`\n${selectedTokenB} down ${spread}%: ${newPriceBDown.toFixed(5)}
	Amount of ${selectedTokenB} to send: ${infinityBuyOutput.toFixed(5)} (${infinityBuyOutputLamports} lamports)
	Amount of ${selectedTokenA} to receive: ${infinityBuyInput.toFixed(5)} (${infinityBuyInputLamports} lamports)`);

	console.log(infinityBuyInputLamports);
	console.log(infinityBuyOutputLamports);
	console.log(infinitySellInputLamports);
	console.log(infinitySellOutputLamports);

	
	await jitoController("infinity");
	console.log(
		"Pause for 5 seconds to allow orders to finalize on blockchain.",
		await delay(5000)
	);
	monitor();
}

async function monitor() {
	if (shutDown) return;
	const maxRetries = 5;
	let retries = 0;
	await updateMainDisplay();
	while (retries < maxRetries) {
		try {
			await checkOpenOrders();
			await handleOrders(checkArray);
			break; // Break the loop if we've successfully handled the price monitoring
		} catch (error) {
			console.log(error);
			console.error(
				`Error: Connection or Token Data Error (Monitor Price) - (Attempt ${retries + 1} of ${maxRetries})`
			);
			retries++;

			if (retries === maxRetries) {
				console.error(
					"Maximum number of retries reached. Unable to retrieve data."
				);
				return null;
			}
		}
	}
}

async function handleOrders(checkArray) {
	if (checkArray.length !== 2) {
		infinityGrid();
	} else {
		console.log("2 open orders. Waiting for change.");
		await delay(monitorDelay);
		await monitor();
	}
}

async function updateUSDVal(mintAddress, balance, decimals) {
	const queryParams = {
		inputMint: mintAddress,
		outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		amount: Math.floor(balance * Math.pow(10, decimals)),
		slippageBps: 0
	};

	try {
		const response = await axios.get(quoteurl, {
			params: queryParams
		});
		// Save USD Balance and adjust down for Lamports
		const usdBalance = response.data.outAmount / Math.pow(10, 6);
		return usdBalance;
	} catch (error) {
		// Error is not critical.
		// Reuse the previous balances and try another update again next cycle.
	}
}

async function updateMainDisplay() {
	console.clear();
	console.log(`Jupgrid v${version}`);
	console.log(`\u{267E}  Infinity Mode`);
	console.log(`\u{1F4B0} Wallet: ${displayAddress}`);
	formatElapsedTime(startTime);
	console.log(`-`);
	console.log(
		`\u{1F527} Settings: ${chalk.cyan(selectedTokenA)}/${chalk.magenta(selectedTokenB)}\n\u{1F3AF} ${selectedTokenB} Target Value: $${infinityTarget}\n\u{1F6A8} Stop Loss at $${stopLossUSD}\n\u{2B65} Spread: ${spread}%\n\u{1F55A} Monitor Delay: ${monitorDelay}ms`
	);
	let displayPrice
	try {
		// Attempt to fetch the new USD values
		const tempUSDBalanceA = await updateUSDVal(
			selectedAddressA,
			currBalanceA,
			selectedDecimalsA
		);
		const tempUSDBalanceB = await updateUSDVal(
			selectedAddressB,
			currBalanceB,
			selectedDecimalsB
		);

		currUSDBalanceA = tempUSDBalanceA ?? currUSDBalanceA; // Fallback to current value if undefined
		currUSDBalanceB = tempUSDBalanceB ?? currUSDBalanceB; // Fallback to current value if undefined
		currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB; // Recalculate total
		tradeSizeInLamports = 1 * Math.pow(10, selectedDecimalsB);
		const queryParams = {
			inputMint: selectedAddressB,
			outputMint: selectedAddressA,
			amount: tradeSizeInLamports,
			slippageBps: 0
		};
		const response = await axios.get(quoteurl, { params: queryParams });
		newPrice = response.data.outAmount;
		displayPrice = newPrice / Math.pow(10, selectedDecimalsA);
	} catch (error) {
		// Error is not critical. Reuse the previous balances and try another update again next cycle.
	}
	if (currUsdTotalBalance < stopLossUSD) {
		// Emergency Stop Loss
		console.clear();
		console.log(
			`\n\u{1F6A8} Emergency Stop Loss Triggered! - Cashing out and Exiting`
		);
		stopLoss = true;
		process.kill(process.pid, "SIGINT");
	}
	console.log(`-
Starting Balance : $${initUsdTotalBalance.toFixed(2)}
Current Balance  : $${currUsdTotalBalance.toFixed(2)}`);
	const profitOrLoss = currUsdTotalBalance - initUsdTotalBalance;
	const percentageChange = (profitOrLoss / initUsdTotalBalance) * 100;
	if (profitOrLoss > 0) {
		console.log(
			`Profit : ${chalk.green(`+$${profitOrLoss.toFixed(2)} (+${percentageChange.toFixed(2)}%)`)}`
		);
	} else if (profitOrLoss < 0) {
		console.log(
			`Loss : ${chalk.red(`-$${Math.abs(profitOrLoss).toFixed(2)} (-${Math.abs(percentageChange).toFixed(2)}%)`)}`
		);
	} else {
		console.log(`Difference : $${profitOrLoss.toFixed(2)} (0.00%)`); // Neutral
	}
	console.log(`Market Change: ${(((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
Performance Delta: ${(percentageChange - ((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
-
Latest Snapshot Balance ${chalk.cyan(selectedTokenA)}: ${chalk.cyan(currBalanceA.toFixed(5))} (Change: ${chalk.cyan((currBalanceA - initBalanceA).toFixed(5))})
Latest Snapshot Balance ${chalk.magenta(selectedTokenB)}: ${chalk.magenta(currBalanceB.toFixed(5))} (Change: ${chalk.magenta((currBalanceB - initBalanceB).toFixed(5))})
-
Starting Balance A - ${chalk.cyan(selectedTokenA)}: ${chalk.cyan(initBalanceA.toFixed(5))}
Starting Balance B - ${chalk.magenta(selectedTokenB)}: ${chalk.magenta(initBalanceB.toFixed(5))}
-
Trades: ${counter}
-
Buy Order Price: ${newPriceBUp.toFixed(9)}
Current Price: ${displayPrice.toFixed(9)}
Sell Order Price: ${newPriceBDown.toFixed(9)}\n`);
}

async function createTx(inAmount, outAmount, inputMint, outputMint, base) {
	if (shutDown) return;

	const maxRetries = 5;
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	let attempt = 0;
	while (attempt < maxRetries) {
		attempt++;
		try {
			const tokenAccounts = await getTokenAccounts(
				connection,
				payer.publicKey,
				new solanaWeb3.PublicKey(
					"9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh"
				)
			);
			if (tokenAccounts.value.length === 0) {
				console.log(
					"No ARB token accounts found. Please purchase at least 25k ARB and try again."
				);
				process.exit(0);
			}

			const response = await fetch(
				"https://jup.ag/api/limit/v1/createOrder",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						owner: payer.publicKey.toString(),
						inAmount,
						outAmount,
						inputMint: inputMint.toString(),
						outputMint: outputMint.toString(),
						expiredAt: null,
						base: base.publicKey.toString(),
						referralAccount:
							"7WGULgEo4Veqj6sCvA3VNxGgBf3EXJd8sW2XniBda3bJ",
						referralName: "Jupiter GridBot"
					})
				}
			);

			if (!response.ok) {
				throw new Error(
					`Failed to create order: ${response.statusText}`
				);
			}

			const responseData = await response.json();
			const { tx: encodedTransaction } = responseData;

			// Deserialize the raw transaction
			const transactionBuf = Buffer.from(encodedTransaction, "base64");
			const transaction = solanaWeb3.Transaction.from(transactionBuf);
			transaction.sign(payer, base);
			return {
				transaction,
				orderPubkey: responseData.orderPubkey
			};

			// to be handled later
			// return { txid, orderPubkey: responseData.orderPubkey};
		} catch (error) {
			await delay(2000);
		}
	}
	// If we get here, its proper broken...
	throw new Error("Order Creation failed after maximum attempts.");
}

function encodeTransactionToBase58(transaction) {
	// Function to encode a transaction to base58
	const encodedTransaction = bs58.encode(transaction.serialize());
	return encodedTransaction;
}

async function jitoTipCheck() {
	try {
	  const response = await fetch(
		"https://jito-labs.metabaseapp.com/api/public/dashboard/016d4d60-e168-4a8f-93c7-4cd5ec6c7c8d/dashcard/154/card/188?parameters=%5B%5D"
	  );
	  if (!response.ok) {
		console.log('Fetch request failed, using default tip value of 0.00005 SOL');
		return 0.00005;
	  }
	  let json;
	  try {
		json = await response.json();
	  } catch (err) {
		console.log('Invalid JSON response, using default tip value of 0.00005 SOL');
		return 0.00005;
	  }
	  const row = json.data.rows[0];
	  const tipVal = Number(row[6].toFixed(8));
	  if (isNaN(tipVal)) {
		console.error('Invalid tip value:', tipVal);
		throw new Error('Invalid tip value');
	  }
	  lastTip = tipVal;
	  return tipVal;
	} catch (err) {
	  console.error(err);
	  return lastTip !== null ? lastTip : 0.00005; // Return a default of 50000 lamports if the request fails
	}
  }

async function jitoController(task) {
	let result = "unknown";
	// Initial operation
	switch (task) {
	case "cancel":
		result = await jitoCancelOrder(task);
		break;
	case "infinity":
		result = await jitoSetInfinity(task);
		break;
	case "rebalance":
		result = await jitoRebalance(task);
		break;
	default:
		// unintended code
		console.log("Unknown Error state. Exiting...");
		process.exit(0);
	}
	jitoRetry = 1;
	// Retry loop
	while (jitoRetry < 20) {
		switch (result) {
		case "succeed":
			console.log("Operation Succeeded\n");

			jitoRetry = 21;
			break;
		case "cancelFail":
			console.log("Retrying Cancel Orders...");
			jitoRetry++;
			result = await jitoCancelOrder(task);
			break;
		case "infinityFail":
			console.log("Retrying Infinity Orders...");
			jitoRetry++;
			result = await jitoSetInfinity(task);
			break;
		case "rebalanceFail":
			console.log("Retrying Rebalance Orders...");
			jitoRetry++;
			result = await jitoRebalance(task);
			break;
		default:
			console.log("Unknown Error state. Exiting...");
			process.exit(0);
		}
	}
}

async function jitoCancelOrder(task) {
	await checkOpenOrders();
	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		return "succeed";
	} else {
		console.log("Cancelling Orders");
		const transaction1 = await cancelOrder(checkArray, payer);
		const result = await handleJitoBundle(task, transaction1);
		return result;
	}
}

async function jitoSetInfinity(task) {
	// cancel any existing, place 2 new
	const base1 = Keypair.generate();
	const base2 = Keypair.generate();

	await checkOpenOrders();

	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		const order1 = await createTx(
			infinityBuyInputLamports,
			infinityBuyOutputLamports,
			selectedAddressA,
			selectedAddressB,
			base1
		);
		const order2 = await createTx(
			infinitySellInputLamports,
			infinitySellOutputLamports,
			selectedAddressB,
			selectedAddressA,
			base2
		);
		const transaction1 = order1.transaction;
		const transaction2 = order2.transaction;
		const transactions = [transaction1, transaction2];
		const result = await handleJitoBundle(task, ...transactions);
		return result;
	} else {
		console.log("Found Orders to Cancel");
		const transaction1 = await cancelOrder(checkArray, payer);
		const order1 = await createTx(
			infinityBuyInputLamports,
			infinityBuyOutputLamports,
			selectedAddressA,
			selectedAddressB,
			base1
		);
		const order2 = await createTx(
			infinitySellInputLamports,
			infinitySellOutputLamports,
			selectedAddressB,
			selectedAddressA,
			base2
		);
		const transaction2 = order1.transaction;
		const transaction3 = order2.transaction;
		const transactions = [transaction1, transaction2, transaction3];
		const result = await handleJitoBundle(task, ...transactions);
		return result;
	}
}

async function jitoRebalance(task) {
	const transaction1 = await balanceCheck();
	if (transaction1 === "skip") {
		console.log("Skipping Rebalance...");
		return "succeed";
	}
	const result = await handleJitoBundle(task, transaction1);
	return result;
}

async function handleJitoBundle(task, ...transactions) {
	let tipValueInSol;
  try {
    tipValueInSol = await jitoTipCheck();
  } catch (err) {
    console.error(err);
    tipValueInSol = 0.00005; // Replace 0 with your default value
  }
  const tipValueInLamports = tipValueInSol * 1_000_000_000;
  const roundedTipValueInLamports = Math.round(tipValueInLamports);

	// Limit to 9 digits
	const limitedTipValueInLamports = Number(
		roundedTipValueInLamports.toFixed(9)
	);
	try {
		const tipAccount = new PublicKey(getRandomTipAccount());
		const instructionsSub = [];
		const tipIxn = SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: tipAccount,
			lamports: limitedTipValueInLamports
		});
		// console.log("Tries: ",retries);
		console.log(
			"Jito Fee:",
			limitedTipValueInLamports / Math.pow(10, 9),
			"SOL"
		);
		instructionsSub.push(tipIxn);
		const resp = await connection.getLatestBlockhash("confirmed");

		const messageSub = new TransactionMessage({
			payerKey: payer.publicKey,
			recentBlockhash: resp.blockhash,
			instructions: instructionsSub
		}).compileToV0Message();

		const txSub = new VersionedTransaction(messageSub);
		txSub.sign([payer]);
		const bundletoSend = [...transactions, txSub];

		// Ensure that bundletoSend is not empty
		if (bundletoSend.length === 0) {
			throw new Error("Bundle is empty.");
		}

		// Call sendJitoBundle with the correct bundleToSend
		const result = await sendJitoBundle(task, bundletoSend);
		return result;
	} catch (error) {
		console.error("\nBundle Construction Error: ", error);
	}
}

async function sendJitoBundle(task, bundletoSend) {
	const encodedBundle = bundletoSend.map(encodeTransactionToBase58);

	const { balanceA: preJitoA, balanceB: preJitoB } = await getBalance(
		payer,
		selectedAddressA,
		selectedAddressB,
		selectedTokenA,
		selectedTokenB
	);
	await checkOpenOrders();
	const preBundleOrders = checkArray;
	// console.log(`PreJitoA: ${preJitoA}`);
	// console.log(`PreJitoB: ${preJitoB}`);

	const data = {
		jsonrpc: "2.0",
		id: 1,
		method: "sendBundle",
		params: [encodedBundle]
	};

	let response;
	const maxRetries = 5;
	for (let i = 0; i <= maxRetries; i++) {
		try {
			response = await fetch(JitoBlockEngine, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(data)
			});

			if (response.ok) break; // if response is ok, we break the loop

			if (response.status === 429) {
				const waitTime = Math.min(MIN_WAIT * Math.pow(2, i), MAX_WAIT);
				const jitter = Math.random() * 0.3 * waitTime;
				await new Promise((resolve) =>
					setTimeout(resolve, waitTime + jitter)
				);
			} else {
				throw new Error("Unexpected error");
			}
		} catch (error) {
			if (i === maxRetries) {
				console.error("Max retries exceeded");
				program.exit(0);
			}
		}
	}
	const responseText = await response.text(); // Get the response body as text
	const responseData = JSON.parse(responseText); // Parse the response body as JSON

	const result = responseData.result;
	const url = `https://explorer.jito.wtf/bundle/${result}`;
	console.log(`\nResult ID: ${url}`);
	// spinner.stop();
	console.log("Checking for 30 seconds...");
	let jitoChecks = 1;
	const maxChecks = 30;
	let spinner;
	let bundleLanded = false;
	while (jitoChecks <= maxChecks) {
		spinner = ora(
			`Checking Jito Bundle Status... ${jitoChecks}/${maxChecks}`
		).start();
		console.log("\nTask: ", task);
		try {
			const { balanceA: postJitoA, balanceB: postJitoB } = await getBalance(
				payer,
				selectedAddressA,
				selectedAddressB,
				selectedTokenA,
				selectedTokenB
			);
			if (postJitoA !== preJitoA || postJitoB !== preJitoB) {
				bundleLanded = true;
				spinner.stop();
				console.log(
					"\nBundle Landed, waiting 30 seconds for orders to finalize..."
				);
				if (task !== "rebalance") {
					let bundleChecks = 1;
						while (bundleChecks <= 30) {
						let postBundleOrders
						await checkOpenOrders();
						postBundleOrders = checkArray;
						if (postBundleOrders !== preBundleOrders) {
							console.log(
								"\nBundle Landed, Orders Updated, Skipping Timer"
							);
							await delay(1000);
							jitoChecks = 31;
							break;
						} else {
							console.log(
								`Checking Orders for ${bundleChecks} of 30 seconds`
							);
							await delay(1000);
							bundleChecks++;
						}
					}
				}
				jitoChecks = 31;
				break;
			}
			jitoChecks++;
			await delay(1000);
		} catch (error) {
			console.error("Error in balance check:", error);
		}
		spinner.stop();
	}

	if (spinner) {
		spinner.stop();
	}

	await checkOpenOrders();
	switch (task) {
	case "cancel":
		if (checkArray.length > 0) {
			console.log("Cancelling Orders Failed, Retrying...");
			return "cancelFail";
		} else {
			console.log("Orders Cancelled Successfully");
			return "succeed";
		}
	case "infinity":
		if (checkArray.length !== 2) {
			console.log("Placing Infinity Orders Failed, Retrying...");
			return "infinityFail";
		} else {
			console.log("Infinity Orders Placed Successfully");
			return "succeed";
		}
	case "rebalance":
		// We dont need to check open orders here
		if (bundleLanded) {
			console.log("Rebalancing Tokens Successful");
			return "succeed";
		} else {
			console.log("Rebalancing Tokens Failed, Retrying...");
			return "rebalanceFail";
		}
	default:
		console.log("Unknown state, retrying...");
		return "unknown";
	}
}

async function rebalanceTokens(
	inputMint,
	outputMint,
	rebalanceValue,
	rebalanceSlippageBPS,
	quoteurl
) {
	if (shutDown) return;
	const rebalanceLamports = Math.floor(rebalanceValue);
	console.log(`Rebalancing Tokens ${chalk.cyan(selectedTokenA)} and ${chalk.magenta(selectedTokenB)}`);

	try {
		// Fetch the quote
		const quoteResponse = await axios.get(
			`${quoteurl}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rebalanceLamports}&slippageBps=${rebalanceSlippageBPS}`
		);

		const swapApiResponse = await fetch(
			"https://quote-api.jup.ag/v6/swap",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					quoteResponse: quoteResponse.data,
					userPublicKey: payer.publicKey,
					wrapAndUnwrapSol: true
				})
			}
		);

		const { blockhash } = await connection.getLatestBlockhash();
		const swapData = await swapApiResponse.json();

		if (!swapData || !swapData.swapTransaction) {
			throw new Error("Swap transaction data not found.");
		}

		// Deserialize the transaction correctly for a versioned message
		const swapTransactionBuffer = Buffer.from(
			swapData.swapTransaction,
			"base64"
		);
		const transaction = VersionedTransaction.deserialize(
			swapTransactionBuffer
		);

		transaction.recentBlockhash = blockhash;
		transaction.sign([payer]);
		return transaction;
	} catch (error) {
		console.error("Error during the transaction:", error);
	}
}

async function checkOpenOrders() {
	openOrders = [];
	checkArray = [];

	// Make the JSON request
	openOrders = await limitOrder.getOrders([
		ownerFilter(payer.publicKey, "processed")
	]);

	// Create an array to hold publicKey values
	checkArray = openOrders.map((order) => order.publicKey.toString());
}

async function cancelOrder(target) {
	console.log(target);
	const requestData = {
		owner: payer.publicKey.toString(),
		feePayer: payer.publicKey.toString(),
		orders: Array.from(target)
	};

	const response = await fetch("https://jup.ag/api/limit/v1/cancelOrders", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(requestData)
	});

	if (!response.ok) {
		console.log("Bad Cancel Order Request");
		throw new Error(`HTTP error! Status: ${response.status}`);
	}

	const responseData = await response.json();
	const transactionBase64 = responseData.tx;
	const transactionBuf = Buffer.from(transactionBase64, "base64");
	const transaction = solanaWeb3.Transaction.from(transactionBuf);

	const { blockhash } = await connection.getLatestBlockhash();
	transaction.recentBlockhash = blockhash;
	transaction.sign(payer);
	return transaction;
}

async function balanceCheck() {
	console.log("Checking Portfolio, we will rebalance if necessary.");
	const currentBalances = await getBalance(
	  payer,
	  selectedAddressA,
	  selectedAddressB,
	  selectedTokenA,
	  selectedTokenB
	);
  
	currBalanceA = currentBalances.balanceA;
	currBalanceB = currentBalances.balanceB;
	currUSDBalanceA = currentBalances.usdBalanceA;
	currUSDBalanceB = currentBalances.usdBalanceB;
	currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB;
	tokenARebalanceValue = currentBalances.tokenARebalanceValue;
	tokenBRebalanceValue = currentBalances.tokenBRebalanceValue;
  
	if (currUsdTotalBalance < infinityTarget) {
	  console.log(
		`Your total balance is not high enough for your Infinity Target. Please either increase your wallet balance or reduce your target.`
	  );
	  process.exit(0);
	}
	const targetUsdBalancePerToken = infinityTarget;
	const percentageDifference = Math.abs(
	  (currUSDBalanceB - targetUsdBalancePerToken) / targetUsdBalancePerToken
	);
	if (percentageDifference > 0.03) {
	  if (currUSDBalanceB < targetUsdBalancePerToken) {
		const deficit =
		  (targetUsdBalancePerToken - currUSDBalanceB) *
		  Math.pow(10, selectedDecimalsA);
		adjustmentA = Math.floor(
		  Math.abs((-1 * deficit) / tokenARebalanceValue)
		);
	  } else if (currUSDBalanceB > targetUsdBalancePerToken) {
		const surplus =
		  (currUSDBalanceB - targetUsdBalancePerToken) *
		  Math.pow(10, selectedDecimalsB);
		adjustmentB = Math.floor(
		  Math.abs(-1 * (surplus / tokenBRebalanceValue))
		);
	  }
	} else {
	  console.log("Token B $ value within 3% of target, skipping rebalance.");
	  return "skip";
	}
	const rebalanceSlippageBPS = 200;
  
	const confirmTransaction = async () => {
		if (!askForRebalance) {
			return true;
		}
		const answer = await questionAsync('Do you want to proceed with this transaction? (Y/n) ');
		if (answer.toUpperCase() === 'N') {
		  console.log('Transaction cancelled by user. Closing program.');
		  process.exit(0);
		} else {
			askForRebalance = false;
		  return true;
		}
	  };
  
	if (adjustmentA > 0) {
	  console.log(
		`Need to trade ${chalk.cyan(adjustmentA / Math.pow(10, selectedDecimalsA))} ${chalk.cyan(selectedTokenA)} to ${chalk.magenta(selectedTokenB)} to balance.`
	  );
	  const userConfirmation = await confirmTransaction();
	  if (userConfirmation) {
		const rebalanceTx = await rebalanceTokens(
		  selectedAddressA,
		  selectedAddressB,
		  adjustmentA,
		  rebalanceSlippageBPS,
		  quoteurl
		);
		return rebalanceTx;
	  } else {
		console.log('Transaction cancelled by user.');
		return;
	  }
	} else if (adjustmentB > 0) {
	  console.log(
		`Need to trade ${chalk.magenta(adjustmentB / Math.pow(10, selectedDecimalsB))} ${chalk.magenta(selectedTokenB)} to ${chalk.cyan(selectedTokenA)} to balance.`
	  );
	  const userConfirmation = await confirmTransaction();
	  if (userConfirmation) {
		const rebalanceTx = await rebalanceTokens(
		  selectedAddressB,
		  selectedAddressA,
		  adjustmentB,
		  rebalanceSlippageBPS,
		  quoteurl
		);
		return rebalanceTx;
	  } else {
		console.log('Transaction cancelled by user.');
		return;
	  }
	}
  }

process.on("SIGINT", () => {
	console.log("\nCTRL+C detected! Performing cleanup...");
	shutDown = true;
	(async () => {
		await jitoController("cancel");
		process.exit(0);
	})();
});

export { connection, initialize };
