import argparse,threading,webbrowser
import uvicorn
from .server import create_app

def main():
    parser=argparse.ArgumentParser(description='Spine Annotator AI app')
    parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true');args=parser.parse_args()
    app=create_app();token=app.state.connection_token
    url=f'http://127.0.0.1:{args.port}/ai/#token={token}'
    print(f'앱 주소: http://127.0.0.1:{args.port}/ai/')
    print('연결 코드 (앱에서 요청하면 입력):',token)
    if not args.no_browser:threading.Timer(1.5,lambda:webbrowser.open(url)).start()
    uvicorn.run(app,host=args.host,port=args.port,access_log=False)

if __name__=='__main__':main()
