import { Client } from "switchchat";
import { split } from "shlex";
import { ArgumentParser } from "argparse";
import axios from "axios";

const sc = new Client(process.env.CHATBOX_TOKEN);

sc.defaultName = "&eSCTrivia";
sc.defaultFormattingMode = "markdown";

const parser = new ArgumentParser({
	prog: "\sctrivia",
	add_help: false,
	exit_on_error: false
});

parser.add_argument("-h","--help",{action:"store_true"});
parser.add_argument("-l","--list-categories",{action:"store_true"});
parser.add_argument("-c","--category");
parser.add_argument("-d","--difficulty");

const CATEGORIES = {'General Knowledge': 9, 'Books': 10, 'Film': 11, 'Music': 12, 'Musicals & Theatres': 13, 'Television': 14, 'Video Games': 15, 'Board Games': 16, 'Science & Nature': 17, 'Computers': 18, 'Mathematics': 19, 'Mythology': 20, 'Sports': 21, 'Geography': 22, 'History': 23, 'Politics': 24, 'Art': 25, 'Celebrities': 26, 'Animals': 27, 'Vehicles': 28, 'Comics': 29, 'Gadgets': 30, 'Japanese Anime & Manga': 31, 'Cartoon & Animations': 32}

function decode_base64(s) {
	return Buffer.from(s,"base64").toString();
}

function decode_question(q) {
	if (typeof q === "string") {
		return decode_base64(q);
	}
	if (typeof q === "object" && !(q instanceof Array)) {
		Object.keys(q).forEach((k) => {
			q[k]=decode_question(q[k]);
		});
	}
	if (q instanceof Array) {
		q = q.map((v)=>{return decode_question(v);});
	}
	return q;
}

let questions = {};

function resolve_category(partial) {
	return Object.keys(CATEGORIES).filter(cat=>cat.toLowerCase().includes(partial.toLowerCase()));
}

function resolve_difficulty(d) {
	d=d.toLowerCase();
	if (d=="ez") return "easy";
	let possible = ["easy","medium","hard"].filter(diff=>diff.startsWith(d));
	if (possible.length>1) return false;
	return possible[0];
}

let token = null;
let token_time = 0;

function shuffle(a) {
	let i=a.length;
	while (i>0) {
		let j=Math.floor(Math.random()*(i+1));
		[a[i],a[j]]=[a[j],a[i]];
		i--;
	}
}

async function get_question(args) {
	if ((Date.now()-token_time)>(6*60*60)||token===null) {
		let {data} = await axios.get("https://opentdb.com/api_token.php?command=request");
		if (data.response_code!==0) {
			throw new Error("Error getting session token! "+JSON.stringify(data));
		}
		token = data.token;
		token_time = Date.now();
	}
	let {data} = await axios.get(`https://opentdb.com/api.php?token=${token}&${args}`);
	if (data.response_code==3) { // token not found
		token=null;
		return get_question(args);
	}
	if (data.response_code==4) { // token empty
		let {data} = await axios.get(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
		if (data.response_code!==0) throw new Error("Error refreshing session token! "+JSON.stringify(data));
		return get_question(args);
	}
	if (data.response_code==0) {
		console.log(JSON.stringify(data.results[0]));
		let question = decode_question(data.results[0]);
		if (question.type==="multiple") {
			question.answers = [question.correct_answer];
			for (let i=0;i<question.incorrect_answers.length;i++) question.answers.push(question.incorrect_answers[i]);
			shuffle(question.answers);
			question.answers=question.answers.filter((v)=>{return (v!==null&&v!==undefined);});
		}
		return question;
	} else {
		throw new Error("Error getting question! "+JSON.stringify(data));
	}
}

sc.on("command",async (cmd) => {
	if (cmd.command=="sctrivia") {
		let args;
		try {
			args = parser.parse_args(split(cmd.args.join(" ")));
		} catch (error) {
			await sc.tell(cmd.user.name,"Error parsing arguments! "+error.toString());
			console.log(error);
			return;
		}
		if (args.help) {
			await sc.tell(cmd.user.name,"Usage: \\sctrivia [-c category] [-d difficulty]\n-c/--category: The category of question. Use -l/--list-categories to list categories, partial matches are allowed.\n-d/--difficulty: The difficulty of question. Easy/medium/hard, you can abbreviate from the first letter, `ez` is allowed as easy.");
			return;
		}
		if (args.list_categories) {
			await sc.tell(cmd.user.name,"Categories: `"+Object.keys(CATEGORIES).join("`,  `")+"`");
		}
		let url_args = "amount=1&encode=base64";
		if (args.category !== undefined) {
			let kategories = resolve_category(args.category);
			if (kategories.length>1) {
				await sc.tell(cmd.user.name,`Ambiguous category; do you mean: ${kategories.join(', ')}`);
				return
			}
			url_args += `&category=${CATEGORIES[kategories[0]]}`;
		}
		if (args.difficulty !== undefined) {
			let diffikulty = resolve_difficulty(args.difficulty);
			if (!diffikulty) {
				await sc.tell(cmd.user.name,`Invalid difficulty ${args.difficulty}!`);
			}
			url_args += `&difficulty=${diffikulty}`;
		}
		try {
			let question = await get_question(url_args);
			console.log(JSON.stringify(question));
			let msg = `Alright, here's a ${question.difficulty} question from the category "${question.category.replace(/^\w+: /,'')}".\n\n`;
			if (question.type=="boolean") {
				msg+=`True or false: ${question.question}\nUse \\sctanswer t for true or \\sctanswer f for false.`
			} else {
				msg+=question.question+"\n"
				for (let i=0;i<question.answers.length;i++) {
					msg+=("ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(i))+". "+question.answers[i]+"\n";
				}
 				msg+="Use \\sctanswer <letter> to answer."
			}
			msg+="\nYou have 30 seconds.";
			questions[cmd.user.uuid]=question;
			await sc.tell(cmd.user.name,msg);
			setTimeout(async ()=>{
				if (questions[cmd.user.uuid]) {
					await sc.tell(cmd.user.name,`Time's up! Correct answer: {question.correct_answer}`);
				}
			},30*1000);
		} catch (err) {
			console.log(err);
			await sc.tell(cmd.user.name,err.toString());
		}
	}
	if (cmd.command=="sctanswer") {
		if (!questions[cmd.user.uuid]) {
			await sc.tell(cmd.user.name,"There's no question for you to answer! Try \\sctrivia.");
			return;
		}
		let question = questions[cmd.user.uuid];
		if (question.type==="boolean") {
			let answer = question.correct_answer==="True";
			if (cmd.args[0]==="t"||cmd.args[0]==="f") {
				let user_answer = cmd.args[0]==="t";
				if (answer===user_answer) {
					await sc.tell(cmd.user.name,"Correct! Well done!");
					questions[cmd.user.uuid]=null;
					return;
				} else {
					await sc.tell(cmd.user.name,`Ooh, I'm sorry! That's incorrect! The answer was ${question.correct_answer.toLowerCase()}.`);
					questions[cmd.user.uuid]=null;
					return
				}
			} else {
				await sc.tell(cmd.user.name,"Use \\sctanswer t for true or \\sctanswer f for false.");
				return;
			}
		}
		if (question.type==="multiple") {
			let answer = question.correct_answer;
			if ("ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(cmd.args[0].toUpperCase())) {
				let user_answer = question.answers["ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(cmd.args[0].toUpperCase())];
				if (answer===user_answer) {
					await sc.tell(cmd.user.name,"Correct! Well done!");
					questions[cmd.user.uuid]=null;
					return;
				} else {
					await sc.tell(cmd.user.name,`Ooh, I'm sorry! That's incorrect! The answer was "${question.correct_answer}".`);
					questions[cmd.user.uuid]=null;
				}
			} else {
				await sc.tell(cmd.user.name,"Use \\sctanswer <letter> to answer.");
				return;
			}
		}
	}
});

sc.connect();
