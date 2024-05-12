//#region imports
import axios from "axios";
import chalk from "chalk";
import fetch from "cross-fetch";
import * as fs from "fs";
import ora from "ora";

import { LimitOrderProvider, ownerFilter } from "@jup-ag/limit-order-sdk";
import * as solanaWeb3 from "@solana/web3.js";
import { Keypair, Connection, PublicKey, VersionedTransaction, SystemProgram, TransactionMessage } from "@solana/web3.js";
import bs58 from 'bs58';



import packageInfo from '../package.json' assert { type: 'json' };
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
	rl,
} from "./utils.js";
import { program } from "@project-serum/anchor/dist/cjs/native/system.js";
//#endregion

//#region constants
// use fs to to read version from package.json
const packageInfo = JSON.parse(fs.readFileSync("package.json", "utf8"));

const version = packageInfo.version;

const [payer, rpcUrl] = envload();

const connection = new Connection(rpcUrl, "processed", {
	confirmTransactionInitialTimeout: 5000,
});
const limitOrder = new LimitOrderProvider(connection);

let shutDown = false;

let walletAddress = payer.publicKey.toString();
let displayAddress = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;

const quoteurl = "https://quote-api.jup.ag/v6/quote";
const JitoBlockEngine = "https://mainnet.block-engine.jito.wtf/api/v1/bundles"

const TIP_ACCOUNTS = [
	'96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
	'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
	'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
	'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
	'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
	'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
	'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
	'3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";

const getRandomTipAccount = () =>
TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];
//#endregion

//#region properties
let {
	validTokenA = null,
	validTokenB = null,
	selectedTokenA = null,
	selectedTokenB = null,
	selectedAddressA = null,
	selectedAddressB = null,
	selectedDecimalsA = null,
	selectedDecimalsB = null,
	validTradeSize = false,
	tradeSize = null,
	tradeSizeInLamports = null,
	validSpread = null,
	stopLossUSD=  null,
	infinityTarget = null,
	loaded = false,
	openOrders = [],
	checkArray = [],
	tokens = [],
	newPrice = null,
	startPrice = null,
	spread = null,
	spreadbps = null,
	priorityFee = null,
	validPriorityFee = false,
	buyInput = null,
	buyOutput = null,
	sellInput = null,
	sellOutput = null,
	buyOutput2 = null,
	sellInput2 = null,
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
	rebalanceAllowed = null,
	validRebalanceAllowed = false,
	rebalanceSlippageBPS = 25,
	validRebalanceSlippage = false,
	rebalancePercentage = 0,
	validRebalancePercentage = false,
	validStopLossUSD = false,
	validInfinityTarget = false,
	startTime = new Date(),
	profitA = null,
	profitB = null,
	monitorDelay = null,
	buyKeyHigh = null,
	buyKeyLow = null,
	sellKeyLow = null,
	sellKeyHigh = null,
	lastFilledOrder = null, // 'buy' or 'sell'
	sortedLayers,
	infinityMode = false,
	adjustmentA = 0,
	adjustmentB = 0,
	infinityInit = true,
	stopLoss = false,
	renewOrders = false,
	transactionArray = [],
	jitoRetry = 0,
	orderToCancel = [],
	newLayer = null,
	newLayer2 = null,
	filledOrder,
	infinityBuyInput,
	infinityBuyOutput,
	infinitySellInput,
	infinitySellOutput,
	userSettings = {
		selectedTokenA: null,
		selectedTokenB: null,
		tradeSize: null,
		spread: null,
		priorityFee: null,
		rebalanceAllowed: null,
		rebalancePercentage: null,
		rebalanceSlippageBPS: null,
		monitorDelay: null,
		stopLossUSD: null,
		infinityTarget: null,
	},
} = {};
//#endregion

async function loadQuestion() {
	try {
		await downloadTokensList();
		console.log("Updated Token List\n");

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
								//Infinity Mode Check
								if (userSettings.infinityMode) {
									console.log(
										`Infinity Mode Enabled.
Infinity Target: ${userSettings.infinityTarget}
Token A: ${userSettings.selectedTokenA}
Token B: ${userSettings.selectedTokenB}
Spread: ${userSettings.spread}%
Priority Fee: ${userSettings.priorityFee}
Stop Loss: ${userSettings.stopLossUSD}
Monitoring delay: ${userSettings.monitorDelay}ms`,
									);	
								} else {
									console.log(`Classic Grid Mode Enabled`)
								console.log(`Token A: ${userSettings.selectedTokenA}
Token B: ${userSettings.selectedTokenB}
Order Size (in ${userSettings.selectedTokenA}): ${userSettings.tradeSize}
Spread: ${userSettings.spread}
Priority Fee: ${userSettings.priorityFee}
Stop Loss: ${userSettings.stopLossUSD}
Monitoring delay: ${userSettings.monitorDelay}ms
Rebalancing is ${userSettings.rebalanceAllowed ? "enabled" : "disabled"}`);
								if (userSettings.rebalanceAllowed) {
									console.log(`Rebalance Threshold: ${userSettings.rebalancePercentage}%
Rebalance Swap Slippage: ${userSettings.rebalanceSlippageBPS / 100}%`);
								}
							}
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
												tradeSize,
												spread,
												priorityFee,
												rebalanceAllowed,
												rebalancePercentage,
												rebalanceSlippageBPS,
												monitorDelay,
												stopLossUSD,
												infinityTarget,
											} = userSettings);
											console.log("Settings applied successfully!");
											initialize();
										} else if (confirmResponse === "N") {
											console.log("Discarding saved settings, please continue.");
											initialize(); // Start initialization with blank settings
										} else {
											console.log("Invalid response. Please type 'Y' or 'N'.");
											askForLoadSettings(); // Re-ask the original question
										}
									},
								);
							} catch (error) {
								console.error(`Failed to load settings: ${error}`);
								initialize(); // Proceed with initialization in case of error
							}
						} else if (responseQ === "N") {
							console.log("Starting with blank settings.");
							initialize();
						} else {
							console.log("Invalid response. Please type 'Y' or 'N'.");
							askForLoadSettings(); // Re-ask if the response is not Y/N
						}
					},
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
	if (tradeSize != null) {
		validTradeSize = true;
	}
	if (spread != null) {
		validSpread = true;
	}
	if (priorityFee != null) {
		validPriorityFee = true;
	}
	if (rebalanceAllowed != null) {
		validRebalanceAllowed = true;
	}
	if (rebalancePercentage != null && rebalancePercentage > 0 && rebalancePercentage <= 10000) {
		validRebalancePercentage = true;
	}
	if (rebalanceSlippageBPS != null && rebalanceSlippageBPS >= 0.1 && rebalanceSlippageBPS <= 100) {
		validRebalanceSlippage = true;
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
			(token) => token.symbol === userSettings.selectedTokenA,
		);
		if (!tokenAExists) {
			console.log(`Token ${userSettings.selectedTokenA} from user data not found in the updated token list. Please re-enter.`);
			userSettings.selectedTokenA = null; // Reset selected token A
			userSettings.selectedAddressA = null; // Reset selected address
			userSettings.selectedDecimalsA = null; // Reset selected token decimals
		} else {
			validTokenA = true;
		}
	}

	while (!validTokenA) {
		const answer = await questionAsync(`Please Enter The First Token Symbol (A) (Case Sensitive): `);
		const token = tokens.find((t) => t.symbol === answer);
		if (token) {
			console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
			const confirmAnswer = await questionAsync(`Is this the correct token? (Y/N): `);
			if (
				confirmAnswer.toLowerCase() === "y" || confirmAnswer.toLowerCase() === "yes"
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
		const tokenBExists = tokens.some((token) => token.symbol === userSettings.selectedTokenB);
		if (!tokenBExists) {
			console.log(`Token ${userSettings.selectedTokenB} from user data not found in the updated token list. Please re-enter.`);
			userSettings.selectedTokenB = null; // Reset selected token B
			userSettings.selectedAddressB = null; // Reset selected address
			userSettings.selectedDecimalsB = null; // Reset selected token decimals
		} else {
			validTokenB = true;
		}
	}
	
	while (!validTokenB) {
		const answer = await questionAsync(`Please Enter The Second Token Symbol (B) (Case Sensitive): `);
		const token = tokens.find((t) => t.symbol === answer);
		if (token) {
			console.log(`Selected Token: ${token.symbol}
Token Address: ${token.address}
Token Decimals: ${token.decimals}`);
			const confirmAnswer = await questionAsync(`Is this the correct token? (Y/N): `);
			if (confirmAnswer.toLowerCase() === "y" || confirmAnswer.toLowerCase() === "yes") {
				validTokenB = true;
				selectedTokenB = token.symbol;
				selectedAddressB = token.address;
				selectedDecimalsB = token.decimals;
			}
		} else {
			console.log(`Token ${answer} not found. Please Try Again.`);
		}
	}

	if (!infinityMode){
		const infinityModeInput = await questionAsync(`Would you like Infinity Mode? (Y/N): `);
		infinityMode = infinityModeInput.toLowerCase() === "y";
	}
	if (infinityMode) {
		if (userSettings.infinityTarget) {
			validInfinityTarget = !isNaN(parseFloat(userSettings.infinityTarget));
			if (!validInfinityTarget) {
				console.log("Invalid infinity target value found in user data. Please re-enter.");
				userSettings.infinityTarget = null; // Reset infinity target value
			} else validInfinityTarget = true;
		}
	
		// If infinity target value is not valid, prompt the user
		while (!validInfinityTarget) {
			const infinityTargetInput = await questionAsync(`Please Enter the Infinity Target Value: `);
			infinityTarget = Math.floor(parseFloat(infinityTargetInput));
			if (!isNaN(infinityTarget) && Number.isInteger(infinityTarget) && infinityTarget > userSettings.stopLossUSD
			) {
				userSettings.infinityTarget = infinityTarget;
				validInfinityTarget = true;
			} else {
				console.log("Invalid infinity target value. Please enter a valid integer that is larger than the stop loss value.");
			}
		}
	}

	// Check if trade size is valid
	if (userSettings.tradeSize) {
		validTradeSize = !isNaN(parseFloat(userSettings.tradeSize));
		if (!validTradeSize) {
			console.log("Invalid trade size found in user data. Please re-enter.");
			userSettings.tradeSize = null; // Reset trade size
		} else validTradeSize = true;
	}

	// If trade size is not valid, prompt the user
	while (!validTradeSize && !infinityMode) {
		const tradeSizeInput = await questionAsync(`Please Enter the Trade Size: `);
		tradeSize = parseFloat(tradeSizeInput);
		if (!isNaN(tradeSize)) {
			userSettings.tradeSize = tradeSize;
			//userSettings.tradeSizeInLamports = tradeSize * Math.pow(10, selectedDecimalsA);
			validTradeSize = true;
		} else {
			console.log("Invalid trade size. Please enter a valid number.");
		}
	}

	// Ask user for spread %
	// Check if spread percentage is valid
	if (userSettings.spread) {
		validSpread = !isNaN(parseFloat(userSettings.spread));
		if (!validSpread) {
			console.log("Invalid spread percentage found in user data. Please re-enter.");
			userSettings.spread = null; // Reset spread percentage
		} else validSpread = true;
	}

	// If spread percentage is not valid, prompt the user
	while (!validSpread) {
		const spreadInput = await questionAsync("What % Spread Difference Between Market and Orders? Recommend >0.3% to cover Jupiter Fees, but 1% or greater for best performance:");
		spread = parseFloat(spreadInput);
		if (!isNaN(spread)) {
			userSettings.spread = spread;
			validSpread = true;
		} else {
			console.log("Invalid spread percentage. Please enter a valid number (No % Symbol).");
		}
	}

	while (rebalanceAllowed === null  && !infinityMode) {
		const rebalanceQuestion = await questionAsync("Do you want to allow rebalancing of Tokens (Currently Experimental)? (Y/N): ");
	
		if (rebalanceQuestion.trim().toUpperCase() === "Y") {
			rebalanceAllowed = true;
	
			const percentageQuestion = await questionAsync("At what balance percentage do you want to rebalance your lower balance token? (Enter a number between 1 and 100): ");
			const parsedPercentage = parseFloat(percentageQuestion.trim());
			if (!isNaN(parsedPercentage) &&	parsedPercentage > 0 &&	parsedPercentage <= 100) {
				rebalancePercentage = parsedPercentage;
			} else {
				console.log("Invalid percentage. Please enter a number between 1 and 100.");
				continue; // Ask the rebalance percentage question again
			}
	
			// Loop for maximum allowed slippage question until a valid answer is given or default is accepted
			let isValidSlippage = false;
			while (!isValidSlippage) {
				const slippageQuestion = await questionAsync(`What is the maximum allowed slippage for the rebalance transaction? (Enter a number between 0.1 and 100, representing percentage, default 0.3%): `);
	
				let parsedSlippage;
				if (slippageQuestion.trim() === "") {
					// User accepted the default value
					parsedSlippage = 0.3;
					isValidSlippage = true;
				} else {
					// User entered a value, attempt to parse it
					parsedSlippage = parseFloat(slippageQuestion.trim());
					if (!isNaN(parsedSlippage) && parsedSlippage >= 0.1 &&	parsedSlippage <= 100) {
						// Valid slippage value entered
						isValidSlippage = true;
					} else {
						console.log("Invalid slippage value. Please enter a number between 0.1 and 100, or press Enter to accept the default value.");
					}
				}
	
				if (isValidSlippage) {
					rebalanceSlippageBPS = parsedSlippage * 100;
				}
			}
		} else if (rebalanceQuestion.trim().toUpperCase() === "N") {
			rebalanceAllowed = false;
			break; // Exit the loop if rebalancing is not allowed
		} else {
			console.log("Invalid input. Please enter 'Y' for Yes or 'N' for No.");
			// Loop will continue asking the rebalance permission question
		}
	}

	if (userSettings.stopLossUSD) {
		validStopLossUSD = !isNaN(parseFloat(userSettings.stopLossUSD));
		if (!validStopLossUSD) {
			console.log("Invalid stop loss value found in user data. Please re-enter.");
			userSettings.stopLossUSD = null; // Reset stop loss value
		} else validStopLossUSD = true;
	}
	
	// If stop loss value is not valid, prompt the user
	while (!validStopLossUSD) {
		const stopLossUSDInput = await questionAsync(`Please Enter the Stop Loss Value in USD: (Enter 0 for no stoploss) `);
		stopLossUSD = parseFloat(stopLossUSDInput);
		if (!isNaN(stopLossUSD)) {
			userSettings.stopLossUSD = stopLossUSD;
			validStopLossUSD = true;
		} else {
			console.log("Invalid stop loss value. Please enter a valid number.");
		}
	}

	if (userSettings.priorityFee) {
		priorityFee = !isNaN(parseFloat(userSettings.priorityFee));
		if (!validPriorityFee) {
			console.log("Invalid priority fee found in user data. Please re-enter.");
			userSettings.priorityFee = null; // Reset spread percentage
		} else validPriorityFee = true;
	}
	
	// If spread percentage is not valid, prompt the user
	while (!validPriorityFee) {
		const priorityFeeInput = await questionAsync("What Priority Fee do you want to use? (Micro Lamports - 1000 = 0.000001000 SOL: ");
		priorityFee = parseFloat(priorityFeeInput);
		if (!isNaN(priorityFee)) {
			userSettings.priorityFee = priorityFee;
			validPriorityFee = true;
		} else {
			console.log("Invalid Priority Fee. Please enter a valid number.");
		}
	}

	while (!validMonitorDelay) {
		const monitorDelayQuestion = await questionAsync(`Enter the delay between price checks in milliseconds (minimum 5000ms): `);
		const parsedMonitorDelay = parseInt(monitorDelayQuestion.trim());
		if (!isNaN(parsedMonitorDelay) && parsedMonitorDelay >= 5000) {
			monitorDelay = parsedMonitorDelay;
			validMonitorDelay = true;
		} else {
			console.log("Invalid monitor delay. Please enter a valid number greater than or equal to 5000.");
		}
	}

	spreadbps = spread * 100;
	rl.close(); // Close the readline interface after question loops are done.
	
	saveuserSettings(selectedTokenA, selectedAddressA, selectedDecimalsA, selectedTokenB, selectedAddressB, selectedDecimalsB, tradeSize, spread, priorityFee, rebalanceAllowed, rebalancePercentage, rebalanceSlippageBPS, monitorDelay, stopLossUSD, infinityTarget, infinityMode);
	//First Price check during init

	if (infinityMode) {
		console.clear();
		console.log(`Starting JupGrid Infinity Mode
Your Token Selection for A - Symbol: ${selectedTokenA}, Address: ${selectedAddressA}
Your Token Selection for B - Symbol: ${selectedTokenB}, Address: ${selectedAddressB}`);
		tradeSizeInLamports = (1 * Math.pow(10, selectedDecimalsB))
		const queryParams = {
			inputMint: selectedAddressB,
			outputMint: selectedAddressA,
			amount: tradeSizeInLamports,
			slippageBps: 0,
		};
		const response = await axios.get(quoteurl, { params: queryParams });
		
		newPrice = response.data.outAmount / Math.pow(10, selectedDecimalsA); 
		startPrice = response.data.outAmount / Math.pow(10, selectedDecimalsA);
		startInfinity();
	} else {
		try {
			tradeSizeInLamports = tradeSize * Math.pow(10, selectedDecimalsA);
			const queryParams = {
				inputMint: selectedAddressA,
				outputMint: selectedAddressB,
				amount: tradeSizeInLamports,
				slippageBps: 0,
			};
			const response = await axios.get(quoteurl, { params: queryParams });
			newPrice = response.data.outAmount; 
			startPrice = response.data.outAmount;

			const layers = generatePriceLayers(startPrice, spreadbps, 500);
			//Calc first price layers
			buyInput = tradeSizeInLamports;
			sellInput2 = layers[2];
			sellInput = layers[1];
			buyOutput = layers[-1];
			buyOutput2 = layers[-2];
			//Get Lamports for Sell Output
			sellOutput = tradeSizeInLamports;
			placingBulkOrders = true;
			//console.clear();
			console.log(`\n\u{1F680} Starting Jupgrid! Version ${version}`);
			startGrid();
			
		} catch (error) {
			console.error(`Error: Connection or Token Data Error
Error:`, error);
			return null; // Return null on error
		}
	}
}

if (loaded === false) {
	loadQuestion();
}

async function startGrid() {
	let initialBalances = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);
	initBalanceA = initialBalances.balanceA;
	initUsdBalanceA = initialBalances.usdBalanceA;
	initBalanceB = initialBalances.balanceB;
	initUsdBalanceB = initialBalances.usdBalanceB;
	initUsdTotalBalance = initUsdBalanceA + initUsdBalanceB;

	let currentBalances = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);
	currBalanceA = currentBalances.balanceA;
	currBalanceB = currentBalances.balanceB;
	currUSDBalanceA = currentBalances.usdBalanceA;
	currUSDBalanceB = currentBalances.usdBalanceB;
	currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB;

	console.log(
		`${chalk.cyan(selectedTokenA)} Balance: ${chalk.cyan(initBalanceA)}, worth $${chalk.cyan(initUsdBalanceA.toFixed(2))}
${chalk.magenta(selectedTokenB)} Balance: ${chalk.magenta(initBalanceB)}, worth $${chalk.magenta(initUsdBalanceB.toFixed(2))}
Total User Balance: $${initUsdTotalBalance.toFixed(2)}`);
	await jitoController("cancel");
	await jitoController("bulk");
	monitorPrice();
}

async function startInfinity() {
	//Balance check and rebalance to start
	//await balanceCheck();
	let initialBalances = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);
	initBalanceA = initialBalances.balanceA;
	initUsdBalanceA = initialBalances.usdBalanceA;
	initBalanceB = initialBalances.balanceB;
	initUsdBalanceB = initialBalances.usdBalanceB;
	initUsdTotalBalance = initUsdBalanceA + initUsdBalanceB;
	infinityGrid();
}

function generatePriceLayers(startPrice, spreadbps, totalLayers) {
    const layers = {};
    const spreadFactor = 1 + spreadbps / 10000; // Convert spreadbps to a multiplicative factor

    for (let i = 1; i <= totalLayers; i++) {
        const upperLayerPrice = Math.round(startPrice / Math.pow(spreadFactor, i));
        const lowerLayerPrice = Math.round(startPrice * Math.pow(spreadFactor, i));

        // Only add the layer if the price is greater than zero, is a whole number, and is less than Number.MAX_SAFE_INTEGER
        if (upperLayerPrice > 0 && Number.isInteger(upperLayerPrice) && upperLayerPrice < Number.MAX_SAFE_INTEGER) {
            layers[i] = upperLayerPrice;
        }
        if (lowerLayerPrice > 0 && Number.isInteger(lowerLayerPrice) && lowerLayerPrice < Number.MAX_SAFE_INTEGER) {
            layers[-i] = lowerLayerPrice;
        }
    }
    layers[0] = Number(newPrice);

    // Convert the layers object to an array of [key, value] pairs
    const layersArray = Object.entries(layers);

    // Sort the array in descending order by key (layer number)
    layersArray.sort((a, b) => Number(b[0]) - Number(a[0]));

    // Convert the sorted array back to an object
    const localSortedLayers = Object.fromEntries(layersArray);

    fs.writeFileSync("userPriceLayers.json",JSON.stringify(localSortedLayers, null, 2),"utf8");

    // Assign localSortedLayers to the global variable
    sortedLayers = localSortedLayers;
	
    return localSortedLayers;
}

async function getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB) {

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
					slippageBps: 0,
				};
				const response = await axios.get(quoteurl, {
					params: queryParams,
				});
				usdBalance = response.data.outAmount / Math.pow(10, 6) || 0;
				tokenRebalanceValue = response.data.outAmount / (lamports / Math.pow(10, 3));
			} catch (error) {
				console.error("Error fetching USDC equivalent for SOL:", error);
			}
		}
		return { balance: solBalance, usdBalance, tokenRebalanceValue };
	}

	async function getTokenAndUSDCBalance(mintAddress, decimals) {
		if (!mintAddress ||	mintAddress === "So11111111111111111111111111111111111111112") {
			return getSOLBalanceAndUSDC();
		}

		const tokenAccounts = await getTokenAccounts(connection, payer.publicKey, mintAddress);
		if (tokenAccounts.value.length > 0) {
			const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
			let usdBalance = 0;
			if (balance === 0) {
				console.log(`You do not have a balance for ${mintAddress}, please check and try again.`);
				process.exit(0);
			}
			if (mintAddress !== USDC_MINT_ADDRESS) {
				const queryParams = {
					inputMint: mintAddress,
					outputMint: USDC_MINT_ADDRESS,
					amount: Math.floor(balance * Math.pow(10, decimals)),
					slippageBps: 0,
				};

				try {
					const response = await axios.get(quoteurl, {
						params: queryParams,
					});
					//Save USD Balance and adjust down for Lamports
					usdBalance = response.data.outAmount / Math.pow(10, 6);
					tokenRebalanceValue = response.data.outAmount / (balance * Math.pow(10, 6));
				} catch (error) {
					console.error("Error fetching USDC equivalent:", error);
					usdBalance = 1;
				}
			} else {
				usdBalance = balance; // If the token is USDC, its balance is its USD equivalent
				if (usdBalance === 0) {
					console.log(`You do not have any USDC, please check and try again.`);
					process.exit(0);
				}
				tokenRebalanceValue = 1;
			}

			return { balance, usdBalance, tokenRebalanceValue };
		} else {
			return { balance: 0, usdBalance: 0, tokenRebalanceValue: null };
		}
	}

	let resultA = await getTokenAndUSDCBalance(selectedAddressA, selectedDecimalsA);
	let resultB = await getTokenAndUSDCBalance(selectedAddressB, selectedDecimalsB);

	if (resultA.balance === 0 || resultB.balance === 0) {
		console.log("Please ensure you have a balance in both tokens to continue.");
		process.exit(0);
	}

	return {
		balanceA: resultA.balance,
		usdBalanceA: resultA.usdBalance,
		tokenARebalanceValue: resultA.tokenRebalanceValue,
		balanceB: resultB.balance,
		usdBalanceB: resultB.usdBalance,
		tokenBRebalanceValue: resultB.tokenRebalanceValue,
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

	console.log(`Run time: ${hours}:${minutes}:${seconds}`);
}

async function infinityGrid() {

	if (shutDown) return;
	if (infinityInit) {
		await jitoController("cancel");
		await jitoController("rebalance");
		infinityInit = false; //Disable rebalance function after 1st run
	}

	let currentBalances = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);

	currBalanceA = currentBalances.balanceA; // Current balance of token A
	currBalanceB = currentBalances.balanceB; // Current balance of token B
	currUSDBalanceA = currentBalances.usdBalanceA; // Current USD balance of token A
	currUSDBalanceB = currentBalances.usdBalanceB; // Current USD balance of token B
	currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB; // Current total USD balance
	let tokenBPrice = currUSDBalanceB / currBalanceB; // Current price of token B
	let tokenAPrice = currUSDBalanceA / currBalanceA; // Current price of token A

	if (currUsdTotalBalance < stopLossUSD) {
		//Emergency Stop Loss
		//console.clear();
		console.log(`\n\u{1F6A8} Emergency Stop Loss Triggered! - Exiting`);
		stopLoss = true;
		cancelOrder();
		process.kill(process.pid, 'SIGINT');
	}
	// Calculate the new prices of tokenB when it's up 1% and down 1%
	let newPriceBUp = tokenBPrice * (1 + spreadbps / 10000); // *1.01 1% increase
	let newPriceBDown = tokenBPrice * (1 - spreadbps / 10000); // *0.99 1% decrease

	console.log(`Current Market Price: ${tokenBPrice.toFixed(5)}
Infinity Target: ${infinityTarget}
Current ${selectedTokenB} Balance: ${currBalanceB} (${currUSDBalanceB.toFixed(2)})

${selectedTokenB} up ${spread}%: ${newPriceBUp.toFixed(5)}
Amount of ${selectedTokenB} to send: ${marketUpIn.toFixed(5)}
Amount of ${selectedTokenA} to receive: ${marketUpOut.toFixed(5)}
Calculated Market Price: ${marketUpCalc.toFixed(5)}`);

console.log(`\n${selectedTokenB} up 1%: ${newPriceBUp}`);
console.log("Amount of B to send: ", marketUpIn);
console.log("Amount of A to receive: ", marketUpOut);
console.log("Calculated Market Price: ", marketUpCalc);

	console.log(`\n${selectedTokenB} down ${spread}%: ${newPriceBDown.toFixed(5)}
Amount of ${selectedTokenB} to recieve: ${marketDownOut.toFixed(5)}
Amount of ${selectedTokenA} to send: ${marketDownIn.toFixed(5)}
Calculated Market Price: ${marketDownCalc.toFixed(5)}`);
	
	//Buy layer
	infinityBuyInput = Math.floor(marketDownIn * Math.pow(10, selectedDecimalsA))
	infinityBuyOutput = Math.floor(marketDownOut * Math.pow(10, selectedDecimalsB))
	infinitySellInput = Math.floor(marketUpIn * Math.pow(10, selectedDecimalsB))
	infinitySellOutput = Math.floor(marketUpOut * Math.pow(10, selectedDecimalsA))

	await jitoController("infinity");
	console.log("Pause for 5 seconds to allow orders to finalize on blockchain.",await delay(5000));
	monitorPrice()
}

async function monitorPrice(maxRetries = 5) {
    if (shutDown) return;
    let retries = 0;
    await updateMainDisplay();
    while (retries < maxRetries) {
        try {
            await checkOpenOrders();
            await handleOrders(checkArray, sortedLayers);
            break; // Break the loop if we've successfully handled the price monitoring
        } catch (error) {
            await handleRetry(error, retries, maxRetries);
        }
    }
}

async function handleOrders(checkArray, sortedLayers) {

	if (infinityMode) {
		if (checkArray.length !== 2) {
			await jitoController("infinity");
			await delay(monitorDelay);
			await monitorPrice();
		} else {
			console.log("2 open orders. Waiting for change.");
			await delay(monitorDelay);
			await monitorPrice();
		}
	} else {
		if (checkArray.length === 0) {
			await handleNoOrders();
		} else if (checkArray.length === 3) {
			// Store the name of the filled order in a variable
			await handleMissingOrders(checkArray, sortedLayers);
		} else if (checkArray.length > 4) {
			await handleExcessiveOrders(checkArray, sortedLayers);
		} else if (checkArray.length != 0 && checkArray.length != 3 && checkArray.length != 4) {
			//Full Reset, unknown state
			await jitoController("cancel");
			await jitoController("bulk");
		} else {
			console.log("4 open orders. Waiting for change.");
			await delay(monitorDelay);
			monitorPrice();
		}
	}
}

async function handleNoOrders() {
    console.log("No orders found. Resetting and placing orders at last known layers.");
    if (infinityMode){
        infinityGrid()
        return
    } else {
        await jitoController("bulk");
		monitorPrice();
    }
}

async function handleMissingOrders(checkArray, sortedLayers) {
    // Identify which key(s) are missing
    
    if (!checkArray.includes(buyKeyHigh)) {
		filledOrder = "High Buy Order";
		orderToCancel = [sellKeyHigh];
	} else if (!checkArray.includes(buyKeyLow)) {
		filledOrder = "Low Buy Order";
		orderToCancel = [sellKeyHigh];
	} else if (!checkArray.includes(sellKeyLow)) {
		filledOrder = "Low Sell Order";
		orderToCancel = [buyKeyLow];
	} else if (!checkArray.includes(sellKeyHigh)) {
		filledOrder = "High Sell Order";
		orderToCancel = [buyKeyLow];
	}

    console.log(`Filled Order: ${filledOrder}. Shifting price points and placing new orders.`);
	await recalculateLayers(sortedLayers);
}

async function handleExcessiveOrders() {
    console.log(`Excessive orders found, resetting.`);
    if (infinityMode){
        jitoController("cancel");
    } else {
        await jitoController("cancel");
		await jitoController("bulk");
		monitorPrice();
    }
}

async function handleRetry(error, retries, maxRetries) {
    console.log(error);
    console.error(`Error: Connection or Token Data Error (Monitor Price) - (Attempt ${retries + 1} of ${maxRetries})`);
    retries++;

    if (retries === maxRetries) {
        console.error("Maximum number of retries reached. Unable to retrieve data.");
        return null;
    }
}

async function updateUSDVal(mintAddress, balance, decimals) {
	const queryParams = {
		inputMint: mintAddress,
		outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		amount: Math.floor(balance * Math.pow(10, decimals)),
		slippageBps: 0,
	};

	try {
		const response = await axios.get(quoteurl, {
			params: queryParams,
		});
		//Save USD Balance and adjust down for Lamports
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
	formatElapsedTime(startTime);
	console.log(`-`);
	if (infinityMode) {
		console.log(`\u{1F527} Settings: ${chalk.cyan(selectedTokenA)}/${chalk.magenta(selectedTokenB)}\n\u{1F3AF} ${selectedTokenB} Target Value: $${infinityTarget}\n\u{1F6A8} Stop Loss at $${stopLossUSD}`,
		);
	} else {
	console.log(`\u{1F527} Settings: ${chalk.cyan(selectedTokenA)}/${chalk.magenta(selectedTokenB)} -\n\u{2195} Spread: ${spread}%`,
	);
	console.log(`-`);

	try {
		// Attempt to fetch the new USD values
		const tempUSDBalanceA = await updateUSDVal(selectedAddressA, currBalanceA, selectedDecimalsA);
		const tempUSDBalanceB = await updateUSDVal(selectedAddressB, currBalanceB, selectedDecimalsB);

		currUSDBalanceA = tempUSDBalanceA ?? currUSDBalanceA; // Fallback to current value if undefined
		currUSDBalanceB = tempUSDBalanceB ?? currUSDBalanceB; // Fallback to current value if undefined
		currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB; // Recalculate total

		const queryParams = {
			inputMint: selectedAddressA,
			outputMint: selectedAddressB,
			amount: tradeSizeInLamports,
			slippageBps: 0,
		};
		const response = await axios.get(quoteurl, { params: queryParams });
		newPrice = response.data.outAmount;
	} catch (error) {
		//Error is not critical. Reuse the previous balances and try another update again next cycle.
	}
	if (currUsdTotalBalance < stopLossUSD) {
		//Emergency Stop Loss
		console.clear();
		console.log(`\n\u{1F6A8} Emergency Stop Loss Triggered! - Cashing out and Exiting`);
		stopLoss = true;
		cancelOrder();
		process.kill(process.pid, 'SIGINT');
	}
	console.log(`-
Starting Balance : $${initUsdTotalBalance.toFixed(2)}
Current Balance  : $${currUsdTotalBalance.toFixed(2)}`);
	let profitOrLoss = currUsdTotalBalance - initUsdTotalBalance;
	let percentageChange = (profitOrLoss / initUsdTotalBalance) * 100;
	if (profitOrLoss > 0) {
		console.log(`Profit : ${chalk.green(`+$${profitOrLoss.toFixed(2)} (${percentageChange.toFixed(2)}%)`)}`);
	} else if (profitOrLoss < 0) {
		console.log(`Loss : ${chalk.red(`-$${Math.abs(profitOrLoss).toFixed(2)} (${Math.abs(percentageChange).toFixed(2)}%)`)}`);
	} else {
		console.log(`Difference : $${profitOrLoss.toFixed(2)} (0.00%)`); // Neutral
	}
	console.log(`Market Change: ${(((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
Performance Delta: ${(percentageChange - ((newPrice - startPrice) / startPrice) * 100).toFixed(2)}%
-
Latest Snapshot Balance ${chalk.cyan(selectedTokenA)}: ${chalk.cyan(currBalanceA.toFixed(5))}
Latest Snapshot Balance ${chalk.magenta(selectedTokenB)}: ${chalk.magenta(currBalanceB.toFixed(5))}`);
}
}

async function recalculateLayers(layers) {
    console.log("\u{1F504} Calculating new price layers");
    buyInput = tradeSizeInLamports;
    sellOutput = tradeSizeInLamports;

	if (!layers) {
		console.log('Error: layers is undefined or null');
		process.exit(0);
	}
    let currentBuyLayer = Object.keys(layers).find((key) => layers[key] === sellInput);
    let currentSellLayer = Object.keys(layers).find((key) => layers[key] === buyOutput);

    if (filledOrder.includes("Buy")) {
        // Price went down, move both orders down
        currentBuyLayer = Number(currentBuyLayer) - 1;
        currentSellLayer = Number(currentSellLayer) - 1;
        console.log(`Last filled order was a buy. Moving down to layer ${currentBuyLayer} for buy order and layer ${currentSellLayer} for sell order.`);
    } else if (filledOrder.includes("Sell")) {
        // Price went up, move both orders up
        currentBuyLayer = Number(currentBuyLayer) + 1;
        currentSellLayer = Number(currentSellLayer) + 1;
        console.log(`Last filled order was a sell. Moving up to layer ${currentBuyLayer} for buy order and layer ${currentSellLayer} for sell order.`);
    } else {
        console.log(`Error in determining last filled order.`);
        process.exit(0);
    }
    sellInput = layers[currentBuyLayer];
    buyOutput = layers[currentSellLayer];

    // Update newLayer based on filled order type
    if (filledOrder.includes("Buy")) {
		newLayer = layers[currentBuyLayer];
		newLayer2 = layers[currentBuyLayer - 1];
		console.log(`High Buy Layer: ${newLayer}`);
		console.log(`buyOutput: ${buyOutput}`);
		console.log(`sellInput: ${sellInput}`);
		console.log(`Low Sell Layer: ${newLayer2}`);
	} else {
		newLayer = layers[currentSellLayer];
		newLayer2 = layers[currentSellLayer + 1];
		console.log(`High Buy Layer: ${newLayer}`);
		console.log(`buyOutput: ${buyOutput}`);
		console.log(`sellInput: ${sellInput}`);
		console.log(`Low Sell Layer: ${newLayer2}`);
	}
	
    await jitoController("renew");
	monitorPrice();
}

async function setOrders() {
	if (shutDown) return;
	console.log("");
	try {
		// Send the "buy" transactions
		if (shutDown) return;
		if (buyInput >= currBalanceA * Math.pow(10, selectedDecimalsA)) {
			console.log(`\u{1F6A8} Insufficient ${selectedTokenA} balance to place buy order.
Balance: ${currBalanceA}. Required: ${buyInput / Math.pow(10, selectedDecimalsA)}
Please balance your tokens and try again. Exiting...`);
			process.exit(0);
		}

		if (shutDown) return;
		if (sellInput >= currBalanceB * Math.pow(10, selectedDecimalsB)) {
			console.log(`\u{1F6A8} Insufficient ${selectedTokenB} balance to place buy order.
Balance: ${currBalanceB}. Required: ${sellInput / Math.pow(10, selectedDecimalsB)}
Please balance tokens and try again. Exiting...`);
			process.exit(0);
		}
		console.log("\u{1F4B1} Placing Trade Layers");

		await jitoController("bulk");
		console.log("Pause for 5 seconds to allow orders to finalize on blockchain.");
		await delay(5000);

		//monitorPrice(selectedAddressA, selectedAddressB, tradeSizeInLamports);
	} catch (error) {
		console.error("Error:", error);
	}
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
				new solanaWeb3.PublicKey("9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh"),
			);
			if (tokenAccounts.value.length === 0) {
				console.log("No ARB token accounts found. Please purchase at least 25k ARB and try again.");
				process.exit(0);
			}
			
			const response = await fetch("https://jup.ag/api/limit/v1/createOrder",
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
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`Failed to create order: ${response.statusText}`);
			}

			const responseData = await response.json();
			const { tx: encodedTransaction } = responseData;

			// Deserialize the raw transaction
			const transactionBuf = Buffer.from(encodedTransaction, "base64");
			const transaction = solanaWeb3.Transaction.from(transactionBuf);
			transaction.sign(payer, base);
			return { transaction: transaction, orderPubkey: responseData.orderPubkey };
			
			//to be handled later
			//return { txid, orderPubkey: responseData.orderPubkey};
		} catch (error) {
				await delay(2000);
			}
		}
	//If we get here, its proper broken...
	throw new Error("Order Creation failed after maximum attempts.");
}

function encodeTransactionToBase58(transaction) {
	// Function to encode a transaction to base58
	const encodedTransaction = bs58.encode(transaction.serialize());
	return encodedTransaction;
}

async function jitoTipCheck() {
    return fetch("https://jito-labs.metabaseapp.com/api/public/dashboard/016d4d60-e168-4a8f-93c7-4cd5ec6c7c8d/dashcard/154/card/188?parameters=%5B%5D")
        .then(response => response.json())
        .then(json => json.data.rows[0])
        .then(row => {
            let data = {
                "time": row[0],
                "landed_tips_25th_percentile_sol": Number(row[1].toFixed(8)),
                "landed_tips_50th_percentile_sol": Number(row[2].toFixed(8)),
                "landed_tips_75th_percentile_sol": Number(row[3].toFixed(8)),
                "landed_tips_95th_percentile_sol": Number(row[4].toFixed(8)),
                "landed_tips_99th_percentile_sol": Number(row[5].toFixed(8)),
				"ema_landed_tips_50th_percentile": Number(row[6].toFixed(8)),
            };
            console.table(data);
            return data;
        })
        .catch(err => console.error(err));
}

async function jitoController(task) {
    console.log("Start Jito Controller");
	console.log(`Task: ${task}`);
	let result = "unknown";
    // Initial operation
    switch(task) {
        case 'cancel':
            result = await jitoCancelOrder(task);
            break;
        case 'bulk':
            result = await jitoBulkOrders(task);
            break;
        case 'renew':
            result = await jitoRenewOrders(task);
            break;
		case 'infinity':
			result = await jitoSetInfinity(task);
			break;
		case 'rebalance':
			result = await jitoRebalance(task);
			break;
		default:
			//unintended code
			break;
    }
	jitoRetry = 1;
    // Retry loop
    while (jitoRetry < 20) {
        console.log("Result: ", result);
        switch(result) {
            case 'succeed':
                console.log("Operation Succeeded");
                jitoRetry = 21;
                break;
            case 'cancelFail':
                console.log("Retrying Cancel Orders...");
                jitoRetry++;
                result = await jitoCancelOrder(task);
                break;
            case 'renewFail':
                console.log("Retrying Renew Orders...");
                jitoRetry++;
                result = await jitoRenewOrders(task);
                break;
            case 'bulkFail':
                console.log("Retrying Bulk Orders...");
                jitoRetry++;
                result = await jitoBulkOrders(task);
                break;
			case 'infinityFail':
				console.log("Retrying Infinity Orders...");
				jitoRetry++;
				result = await jitoSetInfinity(task);
			case 'rebalanceFail':
				console.log("Retrying Rebalance Orders...");
				jitoRetry++;
				result = await jitoRebalance(task);
            case 'unknown':
                console.log("Unknown state, incrementing retry counter...");
                jitoRetry++;
                break;
			default:
				console.log("Default/Error state. Exiting...");
				process.exit(0);
        }
        console.log("End Jito Controller");
    }
}

async function jitoCancelOrder(task) {
	await checkOpenOrders();
	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		return "succeed";
	} else {
		console.log("Cancelling Orders");
		let transaction1 = await cancelOrder(checkArray, payer);
		let result = await handleJitoBundle(task, transaction1)
		return result;
	}
}

async function jitoBulkOrders(task) {
	console.log("Placing Bulk Orders");	
	let base1 = Keypair.generate();
	let base2 = Keypair.generate();
	let base3 = Keypair.generate();
	let base4 = Keypair.generate();
	let buyOrder1 = await createTx(buyInput, buyOutput, selectedAddressA, selectedAddressB, base1);
	let buyOrder2 = await createTx(buyInput, buyOutput2, selectedAddressA, selectedAddressB, base2);
	let sellOrder1 = await createTx(sellInput, sellOutput, selectedAddressB, selectedAddressA, base3);
	let sellOrder2 = await createTx(sellInput2, sellOutput, selectedAddressB, selectedAddressA, base4);
	let transaction1 = buyOrder1.transaction;
	buyKeyHigh = buyOrder1.orderPubkey
	let transaction2 = buyOrder2.transaction;
	buyKeyLow = buyOrder2.orderPubkey
	let transaction3 = sellOrder1.transaction;
	sellKeyLow = sellOrder1.orderPubkey
	let transaction4 = sellOrder2.transaction;
	sellKeyHigh = sellOrder2.orderPubkey
	let transactions = [transaction1, transaction2, transaction3, transaction4];

	console.log("buykeyhigh: ", buyKeyHigh, "InputToken: ", selectedTokenA, "OutputToken: ", selectedTokenB, "Amount: ", buyInput, "Output: ", buyOutput);
	console.log("buykeylow: ", buyKeyLow, "InputToken: ", selectedTokenA, "OutputToken: ", selectedTokenB, "Amount: ", buyInput, "Output: ", buyOutput2);
	console.log("sellkeylow: ", sellKeyLow, "InputToken: ", selectedTokenB, "OutputToken: ", selectedTokenA, "Amount: ", sellInput, "Output: ", sellOutput);
	console.log("sellkeyhigh: ", sellKeyHigh, "InputToken: ", selectedTokenB, "OutputToken: ", selectedTokenA, "Amount: ", sellInput2, "Output: ", sellOutput);


	// Initialize orderArray and add the order keys
	let orderArray = [];
	orderArray.push(buyKeyHigh, buyKeyLow, sellKeyLow, sellKeyHigh);

	let result = await handleJitoBundle(task, ...transactions);
	return result;
}

async function jitoRenewOrders(task) {
    // Cancel the specified order
    let transaction1 = await cancelOrder(orderToCancel);
	let newOrder
	let newOrder2
    let base = Keypair.generate();
	let base1 = Keypair.generate();
    // Place a new order at the specified layer
    console.log("Filled Order: ", filledOrder);
	console.log("Order to Cancel: ", orderToCancel);

    if (filledOrder.includes("Buy")) {
		console.log("Creating New Buy Order");
		console.log("Transaction 2: new buy low", buyInput, selectedTokenA, "for", newLayer, selectedTokenB)
		console.log("Transaction 3: new sell high", newLayer2, selectedTokenB, "for", sellOutput, selectedTokenA)
        newOrder = await createTx(buyInput, newLayer, selectedAddressA, selectedAddressB, base);
		newOrder2 = await createTx(newLayer2, sellOutput, selectedAddressB, selectedAddressA, base1);
		//Newly opened BUY is buyKeyLow
		//Newly opened SELL is Sellkey1
		//Existing SellKey1 is sellKeyHigh
		//Existing buyKeyLow is BuyKey1
		buyKeyLow = buyKeyHigh;
		sellKeyLow = sellKeyHigh
		buyKeyHigh = newOrder.orderPubkey;
		sellKeyHigh = newOrder2.orderPubkey;
		//orderArray = []
		//orderArray.push(buyKeyHigh, buyKeyLow, sellKeyLow, sellKeyHigh);
    } else if (filledOrder.includes("Sell")) {
		console.log("Creating New Sell Order");
		console.log("Transaction 2: new sell high", newLayer, selectedTokenB, "for", sellOutput, selectedTokenA)
		console.log("Transaction 3: new buy low", buyInput, selectedTokenA, "for", newLayer2, selectedTokenB)
        newOrder = await createTx(newLayer, sellOutput, selectedAddressB, selectedAddressA, base);
		newOrder2 = await createTx(buyInput, newLayer2, selectedAddressA, selectedAddressB, base1);
		//Newly opened BUY is Buykey1
		//Newly opened SELL is sellKeyHigh
		//Existing sellKeyHigh is SellKey1
		//Existing BuyKey1 is buyKeyLow
		buyKeyLow = buyKeyHigh;
		sellKeyLow = sellKeyHigh;
		sellKeyHigh = newOrder.orderPubkey;
		buyKeyHigh = newOrder2.orderPubkey;
		//orderArray = []
		//orderArray.push(buyKeyHigh, buyKeyLow, sellKeyLow, sellKeyHigh);
    }
	console.log("Buy Key High: ", buyKeyHigh);
	console.log("Buy Key Low: ", buyKeyLow);
	console.log("Sell Key Low: ", sellKeyLow);
	console.log("Sell Key High: ", sellKeyHigh);
	let transaction2 = newOrder.transaction;
	let transaction3 = newOrder2.transaction;
    // Logic to calculate new order and single order to cancel
    // Create transactions (1x cancel, 1x place)
	let transactions = [transaction1, transaction2, transaction3];
    let result = await handleJitoBundle(task, ...transactions);
    return result;
}

async function jitoSetInfinity(task) {
	//cancel any existing, place 2 new
	let base1 = Keypair.generate();
	let base2 = Keypair.generate();

	await checkOpenOrders();
	console.log('InfBuyIn', infinityBuyInput);
	console.log('InfBuyOut', infinityBuyOutput);
	console.log('InfSellIn', infinitySellInput);
	console.log('InfSellOut',infinitySellOutput);
	if (checkArray.length === 0) {
		console.log("No orders found to cancel.");
		let order1 = await createTx(infinityBuyInput, infinityBuyOutput, selectedAddressA, selectedAddressB, base1);
		let order2 = await createTx(infinitySellInput, infinitySellOutput, selectedAddressB, selectedAddressA, base2);
		let transaction1 = order1.transaction;
		let transaction2 = order2.transaction;
		let transactions = [transaction1, transaction2];
		let result = await handleJitoBundle(task, ...transactions);
		return result;
	} else {
		console.log("Found Orders to Cancel");
		let transaction1 = await cancelOrder(checkArray, payer);
		let order1 = await createTx(infinityBuyInput, infinityBuyOutput, selectedAddressA, selectedAddressB, base1);
		let order2 = await createTx(infinitySellInput, infinitySellOutput, selectedAddressB, selectedAddressA, base2);
		let transaction2 = order1.transaction;
		let transaction3 = order2.transaction;
		let transactions = [transaction1, transaction2, transaction3];
		let result = await handleJitoBundle(task, ...transactions);
		return result;
	}
}

async function jitoRebalance(task) {
	let transaction1 = await balanceCheck();
	let result = await handleJitoBundle(task, transaction1);
	return result;
}

async function handleJitoBundle(task, ...transactions) {
	//console.log(...transactions);
	let jitoData = await jitoTipCheck();
	let tipValueInSol = jitoData.ema_landed_tips_50th_percentile;
	let tipValueInLamports = tipValueInSol * 1_000_000_000;
	let roundedTipValueInLamports = Math.round(tipValueInLamports);

	// Limit to 9 digits
	let limitedTipValueInLamports = Number((roundedTipValueInLamports).toFixed(9));
    try {
        let tipAccount = new PublicKey(getRandomTipAccount());
        const instructionsSub = [];
        const tipIxn = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: tipAccount,
            lamports: limitedTipValueInLamports
        });
        //console.log("Tries: ",retries);
        console.log("Jito Fee: ", limitedTipValueInLamports / Math.pow(10,9), " SOL");
        instructionsSub.push(tipIxn);
        const resp = await connection.getLatestBlockhash('confirmed');

        const messageSub = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: resp.blockhash,
            instructions: instructionsSub,
        }).compileToV0Message();

        const txSub = new VersionedTransaction(messageSub);
        txSub.sign([payer]);
        let bundletoSend = [...transactions, txSub];

        // Ensure that bundletoSend is not empty
        if (bundletoSend.length === 0) {
            throw new Error("Bundle is empty.");
        }

        // Call sendJitoBundle with the correct bundleToSend
        let result = await sendJitoBundle(task, bundletoSend);
		return result;
    } catch (error) {
        console.error("\nBundle Construction Error: ", error);
    }
}

async function sendJitoBundle(task, bundletoSend) {
	const encodedBundle = bundletoSend.map(encodeTransactionToBase58);
	
    const data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [encodedBundle]
    };

    const response = await fetch(JitoBlockEngine, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

	const responseText = await response.text();  // Get the response body as text
    console.log('Response:', responseText);  // Log the response body

    if (!response.ok) {
        let errorData;
        try {
            errorData = JSON.parse(responseText);  // Try to parse the response body as JSON
        } catch {
            errorData = responseText;  // If parsing fails, use the raw response body
        }
        console.error('Error Status:', response.status); // Log the error status (e.g., 404, 500, etc.`)
        console.error('Error Details:', errorData); // Log the error details
        program.exit(0);
    }

    const responseData = JSON.parse(responseText);  // Parse the response body as JSON

    const result = responseData.result;
	const url = `https://explorer.jito.wtf/bundle/${result}`;
	console.log(`\nResult ID: ${url}`);
	//spinner.stop();
	console.log("Checking for 30 seconds...");
	let jitoChecks = 0;
	let maxChecks = 30;
	let bundleLanded = false;
	while (jitoChecks <= maxChecks) {
		//console.clear();
		console.log("Checking Jito Bundle Status...");
		console.log("Task: ", task);
		try {
			console.log('\nAttempt', jitoChecks);
			jitoChecks++;
			console.log('Calling getBundleStatus with:', result);
			let bundleResult = await getBundleStatus(result);
			console.log('getBundleStatus returned:', bundleResult);
			bundleLanded = bundleResult.value.length > 0;
			if (bundleLanded) {
				console.log("Bundle landed, waiting 30 seconds for orders to finalize...")
				await delay(30000);
				jitoChecks = 31;
				break;
			}
			await delay(1000);
		} catch (error) {
			console.error('Error in getBundleStatus:', error);
		}
	}
	
	await checkOpenOrders();
    switch (task) {
		case 'cancel':
			if (checkArray.length > 0) {
				console.log("Cancelling Orders Failed, Retrying...");
				return 'cancelFail';
			} else {
				console.log("Orders Cancelled Successfully");
				return 'succeed';
			}
		case 'renew':
			if (checkArray.length !== 4) {
				console.log("Renewing Orders Failed, Retrying...");
				return 'renewFail';
			} else {
				console.log("Orders Renewed Successfully");
				return 'succeed';
			}
		case 'bulk':
			if (checkArray.length !== 4) {
				console.log("Placing Bulk Orders Failed, Retrying...");
				return 'bulkFail';
			} else {
				console.log("Bulk Orders Placed Successfully");
				return 'succeed';
			}
		case 'infinity':
			if (checkArray.length !== 2) {
				console.log("Placing Infinity Orders Failed, Retrying...");
				return 'infinityFail';
			} else {
				console.log("Infinity Orders Placed Successfully");
				return 'succeed';
			}
		case 'rebalance':
			//We dont need to check open orders here
			if (bundleLanded) {
				console.log("Rebalancing Tokens Successful");
				return 'succeed';
			} else {
				console.log("Rebalancing Tokens Failed, Retrying...");
				return 'rebalanceFail';
			}
		default:
			console.log("Unknown state, retrying...");
			return 'unknown';
	}
}

async function getBundleStatus(bundleId) {
    const url = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
    const data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const responseText = await response.text();  // Get the response body as text

    if (!response.ok) {
        console.error('Error Status:', response.status); // Log the error status (e.g., 404, 500, etc.)
        console.error('Error Response:', responseText); // Log the raw response body
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    let responseData;
    try {
        responseData = JSON.parse(responseText);  // Try to parse the response body as JSON
    } catch (error) {
        console.error('Failed to parse response as JSON:', responseText);  // Log the raw response body
        throw error;
    }

    return responseData.result;
}

async function rebalanceTokens(inputMint, outputMint, rebalanceValue, rebalanceSlippageBPS, quoteurl) {
	if (shutDown) return;
	const rebalanceLamports = Math.floor(rebalanceValue);
	console.log(`Rebalancing Tokens ${selectedTokenA} and ${selectedTokenB}`);
	
		try {
			// Fetch the quote
			const quoteResponse = await axios.get(
				`${quoteurl}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${rebalanceLamports}&slippageBps=${rebalanceSlippageBPS}`,
			);

			const swapApiResponse = await fetch("https://quote-api.jup.ag/v6/swap",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						quoteResponse: quoteResponse.data,
						userPublicKey: payer.publicKey,
						wrapAndUnwrapSol: true,
					}),
				},
			);

			const { blockhash } = await connection.getLatestBlockhash();
			const swapData = await swapApiResponse.json();

			if (!swapData || !swapData.swapTransaction) {
				throw new Error("Swap transaction data not found.");
			}

			// Deserialize the transaction correctly for a versioned message
			const swapTransactionBuffer = Buffer.from(swapData.swapTransaction, "base64");
			let transaction = VersionedTransaction.deserialize(swapTransactionBuffer);

			transaction.recentBlockhash = blockhash;
			transaction.sign([payer]);
			return transaction;
		} catch (error) {
			console.error("Error during the transaction:", error);
		}
}

async function checkOpenOrders() {

	openOrders = []
	checkArray = []

	// Make the JSON request
	openOrders = await limitOrder.getOrders([
		ownerFilter(payer.publicKey, "processed"),
	]);

	// Create an array to hold publicKey values
	checkArray = openOrders.map((order) => order.publicKey.toString());
}

async function cancelOrder(target) {
	console.log(target);
    const requestData = {
        owner: payer.publicKey.toString(),
        feePayer: payer.publicKey.toString(),
        orders: Array.from(target),
    };

    const response = await fetch("https://jup.ag/api/limit/v1/cancelOrders", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
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
	//Update balances and profits
	let currentBalances = await getBalance(payer, selectedAddressA, selectedAddressB, selectedTokenA, selectedTokenB);
	console.log("Balances Updated");
	// Calculate profit
	profitA = currentBalances.usdBalanceA - initUsdBalanceA;
	profitB = currentBalances.usdBalanceB - initUsdBalanceB;
	currBalanceA = currentBalances.balanceA;
	currBalanceB = currentBalances.balanceB;
	currUSDBalanceA = currentBalances.usdBalanceA;
	currUSDBalanceB = currentBalances.usdBalanceB;
	currUsdTotalBalance = currUSDBalanceA + currUSDBalanceB;
	let percentageOfA = 0;
	let percentageOfB = 0;
	if (currUsdTotalBalance > 0) {
		percentageOfA = (currUSDBalanceA / currUsdTotalBalance) * 100;
		percentageOfB = (currUSDBalanceB / currUsdTotalBalance) * 100;
	}
	tokenARebalanceValue = currentBalances.tokenARebalanceValue;
	tokenBRebalanceValue = currentBalances.tokenBRebalanceValue;

	
	//Rebalancing allowed check
	if ((rebalanceAllowed && (percentageOfA < rebalancePercentage || percentageOfB < rebalancePercentage)) || infinityMode) {
		if (infinityMode) {
			if (currUsdTotalBalance < infinityTarget) {
				console.log(`Your total balance is not high enough for your Infinity Target. Please either increase your wallet balance or reduce your target.`);
				process.exit(0); // Exit program
			}
			let targetUsdBalancePerToken = infinityTarget;
			if (currUSDBalanceB < targetUsdBalancePerToken) {
				// Calculate how much more of TokenB we need to reach the target
				let deficit = (targetUsdBalancePerToken - currUSDBalanceB) * Math.pow(10, selectedDecimalsA);
				// Calculate how much of TokenA we need to sell to buy the deficit amount of TokenB
				adjustmentA = -1 * deficit / tokenARebalanceValue;
			} else if (currUSDBalanceB > targetUsdBalancePerToken) {
				// Calculate how much we have exceeded the target
				let surplus = (currUSDBalanceB - targetUsdBalancePerToken) * Math.pow(10, selectedDecimalsB);
				// Calculate how much of TokenB we need to sell to get rid of the surplus
				adjustmentB = -1 * (surplus / tokenBRebalanceValue);
			}
			rebalanceSlippageBPS = 200;
			console.log("Infinity Mode Enabled");
		} else {
			let targetUsdBalancePerToken = currUsdTotalBalance / 2;
		adjustmentA = targetUsdBalancePerToken - currUSDBalanceA;
		adjustmentB = targetUsdBalancePerToken - currUSDBalanceB;
		}

		if (adjustmentA < 0) {
			// Token A's USD balance is above the target, calculate how much Token A to sell
			let rebalanceValue = adjustmentA;
			if (!infinityMode) {
				rebalanceValue = (Math.abs(adjustmentA) / Math.abs(tokenARebalanceValue)) * Math.pow(10, selectedDecimalsA);
			}
			console.log(`Need to sell ${chalk.cyan(Math.abs(rebalanceValue / Math.pow(10, selectedDecimalsA)))} ${chalk.cyan(selectedTokenA)} to balance.`);
			let rebalanceTx = await rebalanceTokens(selectedAddressA, selectedAddressB, Math.abs(rebalanceValue), rebalanceSlippageBPS, quoteurl);
			return rebalanceTx;
		} else if (adjustmentB < 0) {
			// Token B's USD balance is above the target, calculate how much Token B to sell
			let rebalanceValue = adjustmentB;
			if (!infinityMode) {
				rebalanceValue = (Math.abs(adjustmentB) / Math.abs(tokenBRebalanceValue)) * Math.pow(10, selectedDecimalsB);
			}
			console.log(`Need to sell ${chalk.magenta(Math.abs(rebalanceValue / Math.pow(10, selectedDecimalsB)))} ${chalk.magenta(selectedTokenB)} to balance.`);
			let rebalanceTx = await rebalanceTokens(selectedAddressB, selectedAddressA, Math.abs(rebalanceValue), rebalanceSlippageBPS, quoteurl);
			return rebalanceTx;
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
