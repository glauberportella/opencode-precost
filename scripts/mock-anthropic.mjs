import http from 'node:http'; import { appendFileSync } from 'node:fs';
http.createServer((req, res) => { let b=''; req.on('data', c=>b+=c); req.on('end', () => {
  appendFileSync((process.env.MOCKDIR||'/tmp')+'/mock.log', `${req.method} ${req.url} ${b.length}\n`);
  if (req.url.startsWith('/v1/messages') && req.method==='POST' && !req.url.includes('count_tokens')) {
    let j={}; try{j=JSON.parse(b)}catch{}
    appendFileSync((process.env.MOCKDIR||'/tmp')+'/mock-model-calls.log', `model=${j.model} stream=${j.stream}\n`);
    const ev=(t,d)=>`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    const msg={id:'msg_1',type:'message',role:'assistant',model:j.model??'claude-sonnet-5.5',content:[{type:'text',text:'mock ok'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:12,output_tokens:3}};
    if (!j.stream) { res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify(msg)); }
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write(ev('message_start',{type:'message_start',message:{...msg,content:[],stop_reason:null,usage:{input_tokens:12,output_tokens:1}}}));
    res.write(ev('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}));
    res.write(ev('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'mock ok'}}));
    res.write(ev('content_block_stop',{type:'content_block_stop',index:0}));
    res.write(ev('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}));
    res.end(ev('message_stop',{type:'message_stop'}));
  } else { res.writeHead(404,{'content-type':'application/json'}); res.end('{"error":{"type":"not_found_error","message":"mock"}}'); }
});}).listen(4590,'127.0.0.1');
