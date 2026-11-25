import http from 'node:http'; import { appendFileSync } from 'node:fs';
http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{
 appendFileSync(process.env.MOCKLOG,`${req.method} ${req.url} ${b.length}\n`);
 if(req.url.endsWith('/chat/completions')){ let j={};try{j=JSON.parse(b)}catch{}
  const mk=(d,extra={})=>`data: ${JSON.stringify({id:'c1',object:'chat.completion.chunk',created:1,model:j.model,choices:[d],...extra})}\n\n`;
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write(mk({index:0,delta:{role:'assistant',content:'mock '},finish_reason:null}));
  res.write(mk({index:0,delta:{content:'resposta'},finish_reason:null}));
  res.write(mk({index:0,delta:{},finish_reason:'stop'}));
  res.write(`data: ${JSON.stringify({id:'c1',object:'chat.completion.chunk',created:1,model:j.model,choices:[],usage:{prompt_tokens:1234,completion_tokens:56,total_tokens:1290,prompt_tokens_details:{cached_tokens:200}}})}\n\n`);
  res.end('data: [DONE]\n\n');
 } else {res.writeHead(404);res.end('{}');}
});}).listen(4591,'127.0.0.1');
