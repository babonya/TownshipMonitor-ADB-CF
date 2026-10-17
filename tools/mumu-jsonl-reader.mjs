export class JsonlReader{
  constructor({maxBytes=12*1024*1024}={}){this.buffer='';this.maxBytes=maxBytes;}
  append(data){this.buffer+=data;if(Buffer.byteLength(this.buffer)>this.maxBytes)throw Error('PERCEPTION_RESPONSE_TOO_LARGE');}
  next(){
    while(true){
      const end=this.buffer.indexOf('\n');if(end<0)return {done:true};
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
      try{return {done:false,value:JSON.parse(line)};}catch{throw Error('PERCEPTION_RESPONSE_INVALID');}
    }
  }
}
