process.on('uncaughtException', function (err) {
    console.error('uncaughtException',err);
});
var fs = require('fs');
var path = require('path');
var mysql = require('mysql');
var moment = require('moment');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
const del = require('del');
var config=require('./conf.json');
var sql=mysql.createConnection(config.db);

//set option defaults
s={};
if(!config.cron)config.cron={};
if(!config.cron.deleteOld)config.cron.deleteOld=true;
if(!config.cron.deleteNoVideo)config.cron.deleteNoVideo=true;
if(!config.cron.deleteOverMax)config.cron.deleteOverMax=true;

if(!config.videosDir){config.videosDir=__dirname+'/videos/'}
s.dir={videos:config.videosDir};

s.moment=function(e,x){
    if(!e){e=new Date};if(!x){x='YYYY-MM-DDTHH-mm-ss'};
    e=moment(e);if(config.utcOffset){e=e.utcOffset(config.utcOffset)}
    return e.format(x);
}
s.moment_noOffset=function(e,x){
    if(!e){e=new Date};if(!x){x='YYYY-MM-DDTHH-mm-ss'};
    return moment(e).format(x);
}
s.nameToTime=function(x){x=x.replace('.webm','').replace('.mp4','').split('T'),x[1]=x[1].replace(/-/g,':');x=x.join(' ');return x;}
io = require('socket.io-client')('ws://localhost:'+config.port);//connect to master
s.cx=function(x){return io.emit('cron',x)}
//emulate master socket emitter
s.tx=function(x,y){s.cx({f:'s.tx',data:x,to:y})}
//Cron Job
s.cx({f:'init',time:moment()})
s.cron=function(){
    x={};
    s.cx({f:'start',time:moment()})
    sql.query('SELECT ke,uid,details FROM Users WHERE details NOT LIKE \'%"sub"%\'', function(arr,r) {
        if(r&&r[0]){
            arr={};
            r.forEach(function(v){
                if(!arr[v.ke]){arr[v.ke]=0;}else{return false;}
                //set permissions
                v.d=JSON.parse(v.details);
                if(!v.d.size){if(!v.d.super){v.d.size=10000}else{v.d.size=20000}}else{v.d.size=parseFloat(v.d.size)};//in Megabytes
                if(!v.d.days){if(!v.d.super){v.d.days=3}else{v.d.days=15}}else{v.d.days=parseFloat(v.d.days)};
                //check for old videos
                sql.query('SELECT * FROM Videos WHERE ke = ? AND end < DATE_SUB(NOW(), INTERVAL ? DAY);',[v.ke,v.d.days],function(err,evs,es){
                    if(evs&&evs[0]){
                        es={};
                        es.del=[];
                        es.ar=[v.ke];
                        es.qu=[];
                        if(config.cron.deleteOld===true){
                            evs.forEach(function(ev){
                                es.qu.push('(mid=? AND time=?)');es.ar.push(ev.mid),es.ar.push(ev.time);
                                es.del.push(s.dir.videos+v.ke+'/'+ev.mid+'/'+s.moment_noOffset(ev.time)+'.'+ev.ext);
                                exec('rm '+ev.dir);
                                s.tx({f:'video_delete',filename:s.moment_noOffset(ev.time)+'.'+ev.ext,mid:ev.mid,ke:ev.ke,time:ev.time,end:s.moment_noOffset(new Date,'YYYY-MM-DD HH:mm:ss')},'GRP_'+ev.ke);
                            });
                        }
                        if(es.del.length>0){
                            es.qu=es.qu.join(' OR ');
                            sql.query('DELETE FROM Videos WHERE ke =? AND ('+es.qu+')',es.ar)
                        }else{
                            s.cx({f:'did',msg:'0 old videos deleted',time:moment()})
                        }
                    }
                    //purge SQL rows with no file
                    es.fn=function(){
                        es.size=0;
                        sql.query('SELECT * FROM Videos WHERE ke = ?;',[v.ke],function(err,evs){
                            if(evs&&evs[0]){
                                es.del=[];es.ar=[v.ke];
                                evs.forEach(function(ev){
                                   es.size+=ev.size/1000000;
                                    ev.dir=s.dir.videos+v.ke+'/'+ev.mid+'/'+s.moment_noOffset(ev.time)+'.'+ev.ext;
                                    if(config.cron.deleteNoVideo===true&&!fs.existsSync(ev.dir)){
                                        es.del.push('(mid=? AND time=?)');
                                        es.ar.push(ev.mid),es.ar.push(ev.time);
                                        exec('rm '+ev.dir);
                                        s.tx({f:'video_delete',filename:s.moment_noOffset(ev.time)+'.'+ev.ext,mid:ev.mid,ke:ev.ke,time:ev.time,end:s.moment_noOffset(new Date,'YYYY-MM-DD HH:mm:ss')},'GRP_'+ev.ke);
                                    }
                                })
                                if(es.del.length>0){
                                    es.del=es.del.join(' OR ');
                                    sql.query('DELETE FROM Videos WHERE ke =? AND ('+es.del+')',es.ar)
                                }
                                s.cx({f:'did',msg:es.del.length+' SQL rows with no file deleted',ke:v.ke,time:moment()})
                            }
                            if(config.cron.deleteOverMax===true&&es.size>v.d.size){
                                sql.query('SELECT * FROM Videos WHERE ke=? ORDER BY `time` ASC LIMIT 10',[v.ke],function(err,evs){
                                es.del=[];es.ar=[v.ke];
                                    evs.forEach(function(ev){
                                        ev.dir=s.dir.videos+v.ke+'/'+ev.mid+'/'+s.moment_noOffset(ev.time)+'.'+ev.ext;
                                        es.del.push('(mid=? AND time=?)');
                                        es.ar.push(ev.mid),es.ar.push(ev.time);
                                        exec('rm '+ev.dir);
                                        s.tx({f:'video_delete',filename:s.moment_noOffset(ev.time)+'.'+ev.ext,mid:ev.mid,ke:ev.ke,time:ev.time,end:s.moment_noOffset(new Date,'YYYY-MM-DD HH:mm:ss')},'GRP_'+ev.ke);

                                    });
                                    if(es.del.length>0){
                                        es.qu=es.del.join(' OR ');
                                        sql.query('DELETE FROM Videos WHERE ke =? AND ('+es.qu+')',es.ar,function(){
                                            es.fn()
                                        })
                                        s.cx({f:'did',msg:es.del.length+' old videos deleted because over max of '+v.d.size+' MB',ke:v.ke,time:moment()})
                                    }
                                })
                            }
                        })
                    };
                    es.fn();
                })
            })
        }
    })
}
setInterval(function(){
    s.cron();
},600000*60)//every hour
s.cron()
console.log('Shinobi : cron.js started')